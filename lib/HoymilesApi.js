'use strict';

const { createHash } = require('crypto');
const { postJson, getJson } = require('./HttpClient');

const BASE_URL_GLOBAL = 'https://neapi.hoymiles.com';
const BASE_URL_EU     = 'https://euapi.hoymiles.com';

const AUTH_MODE_AUTO        = 'auto';
const AUTH_MODE_WEB_V3      = 'web_v3';
const AUTH_MODE_INSTALLER_V3 = 'installer_v3';
const AUTH_MODE_HOME_V3     = 'home_v3';
const AUTH_MODE_LEGACY_V0   = 'legacy_v0';

const BATTERY_MODES = {
  1: 'Self-Consumption',
  2: 'Economy',
  3: 'Backup',
  4: 'Off-Grid',
  5: 'Force Charge',
  6: 'Force Discharge',
  7: 'Peak Shaving',
  8: 'Time of Use',
};

const ENDPOINTS = {
  PRE_INSP_V3:   '/iam/pub/3/auth/pre-insp',
  AUTH_V3:       '/iam/pub/3/auth/login',
  AUTH_V0:       '/iam/pub/0/auth/login',
  STATIONS:      '/pvm/api/0/station/select_by_page',
  STATION_DATA:  '/pvm-data/api/0/station/data/count_station_real_data',
  // Correct device tree endpoint — returns full tree with DTU, inverters, HiBox, batteries
  DEVICE_TREE:   '/pvm/api/0/station/select_device_of_tree',
  // Legacy endpoint (fallback only)
  DEVICE_LIST:   '/pvm-data/api/0/station/data/count_device_by_station',
  SETTING_READ:  '/pvm-ctl/api/0/dev/setting/read',
  SETTING_WRITE: '/pvm-ctl/api/0/dev/setting/write',
  SETTING_STATUS: '/pvm-ctl/api/0/dev/setting/status',
  JOB_STATUS:    '/pvm-ctl/api/0/dev/setting/read_status',
  EPS_PROFIT:    '/eps/api/0/record/stat_a',
};

// Action IDs for async setting commands
const BATTERY_SETTINGS_ACTION_ID = 1013;
const SETTING_STATUS_RUNNING = 2;
const SETTING_STATUS_SUCCESS = 0;
const SETTING_MAX_POLLS = 20;
const SETTING_POLL_INTERVAL_MS = 1500;

// Per-mode key inside the settings payload ("k_1".."k_8")
const MODE_KEYS = Object.fromEntries(Object.keys(BATTERY_MODES).map(m => [m, `k_${m}`]));

// Client profiles tried in order during auto login.
// The "home" profile is for consumer accounts ("The account can only be used
// for logging in to the S-Miles Home app"). Auth must go directly to the EU
// consumer gateway; the standard host 307-redirects auth.
const CLIENT_PROFILES = [
  {
    name: AUTH_MODE_WEB_V3,
    headers: { 'User-Agent': 'Homey-HoymilesHiOne' },
  },
  {
    name: AUTH_MODE_INSTALLER_V3,
    headers: {
      'User-Agent':    'S-Miles Installer/3.7.1',
      'App-Version':   '3.7.1',
      'X-App-Version': '3.7.1',
      'X-Client-Type': 'mobile',
    },
  },
  {
    name: AUTH_MODE_HOME_V3,
    headers: { 'User-Agent': 'sma/ad/2.10.0/159/0' },
    authBaseUrl: BASE_URL_EU,
  },
];

const AUTO_ORDER = CLIENT_PROFILES.map(p => p.name);

class HoymilesApi {
  constructor({ log = console.log, error = console.error, baseUrl = null } = {}) {
    this._log     = log;
    this._error   = error;
    this._userBaseUrl = baseUrl || null;
    this._baseUrl = baseUrl || BASE_URL_GLOBAL;
    this._token   = null;
    this._email   = null;
    this._password = null;
    this._authMode = null;
    this._profileHeaders = CLIENT_PROFILES[0].headers;
  }

  get isLoggedIn() { return !!this._token; }

  async login(email, password, mode = AUTH_MODE_AUTO) {
    this._email    = email;
    this._password = password;

    const profilesToTry = mode === AUTH_MODE_AUTO
      ? CLIENT_PROFILES
      : CLIENT_PROFILES.filter(p => p.name === mode);

    const attempts = [];

    // Try v3 two-step auth with each profile
    for (const profile of profilesToTry) {
      try {
        const token = await this._loginV3(profile);
        if (token) {
          this._token = token;
          this._authMode = profile.name;
          this._profileHeaders = profile.headers;
          if (!this._userBaseUrl && profile.authBaseUrl) {
            this._baseUrl = profile.authBaseUrl;
          }
          this._log(`Login succeeded with v3 ${profile.name}, baseUrl: ${this._baseUrl}`);
          return;
        }
      } catch (err) {
        attempts.push(`v3 ${profile.name}: ${err.message}`);
        this._log(`Login v3 ${profile.name} failed: ${err.message}`);
      }
    }

    // Fallback: legacy v0 MD5 login
    try {
      const token = await this._loginLegacy();
      if (token) {
        this._token = token;
        this._authMode = AUTH_MODE_LEGACY_V0;
        this._profileHeaders = CLIENT_PROFILES[0].headers;
        this._log(`Login succeeded with legacy v0, baseUrl: ${this._baseUrl}`);
        return;
      }
    } catch (err) {
      attempts.push(`v0: ${err.message}`);
      this._log(`Login legacy v0 failed: ${err.message}`);
    }

    const detail = attempts.join('; ');
    throw new Error(`Login failed — check your S-Miles Cloud email and password (${detail})`);
  }

  // ── v3 two-step auth: pre-inspect → credential hash → login ──
  async _loginV3(profile) {
    const authBase = profile.authBaseUrl || this._baseUrl;

    // Step 1: pre-inspect to get nonce (and optional salt for Argon2)
    const preInspect = async () => {
      const preUrl = authBase + ENDPOINTS.PRE_INSP_V3;
      const preRes = await postJson(preUrl, { u: this._email }, profile.headers, 10000);
      if (!preRes.ok || !preRes.data) throw new Error(`pre-insp HTTP ${preRes.status}`);
      const d = preRes.data;
      if (String(d.status || '0') !== '0') {
        throw new Error(`pre-insp error: ${d.message || d.msg || JSON.stringify(d)}`);
      }
      const preData = d.data || d;
      if (!preData.n) throw new Error('pre-insp returned no nonce');
      return preData;
    };

    let preData = await preInspect();

    // Salted account → Argon2id hash
    if (preData.a) {
      const ch = await this._argon2Hash(this._password, preData.a);
      return this._loginV3Submit(authBase, profile.headers, ch, preData.n);
    }

    // No salt → try observed unsalted hash variants
    const md5Hex    = createHash('md5').update(this._password).digest('hex');
    const sha256B64 = createHash('sha256').update(this._password).digest('base64');
    const sha256Hex = createHash('sha256').update(this._password).digest('hex');

    const candidates = [
      `${md5Hex}.${sha256B64}`,  // dotted md5 + base64(sha256)
      sha256Hex,                  // plain sha256 hex
    ];

    for (let i = 0; i < candidates.length; i++) {
      // Each attempt consumes the nonce, so re-inspect on retry
      if (i > 0) preData = await preInspect();
      try {
        const token = await this._loginV3Submit(authBase, profile.headers, candidates[i], preData.n);
        if (token) return token;
      } catch (_) {
        // try next hash variant
      }
    }
    return null;
  }

  async _loginV3Submit(authBase, headers, ch, nonce) {
    const loginUrl = authBase + ENDPOINTS.AUTH_V3;
    const res = await postJson(loginUrl, { u: this._email, ch, n: nonce }, headers, 10000);
    if (!res.ok || !res.data) throw new Error(`Auth HTTP ${res.status}`);
    const d = res.data;
    if (String(d.status || '') !== '0') {
      throw new Error(d.message || d.msg || `status ${d.status}`);
    }
    return (d.data && d.data.token) || null;
  }

  async _argon2Hash(password, saltValue) {
    const { argon2id } = require('hash-wasm');
    return argon2id({
      password,
      salt:        this._decodeSalt(saltValue),
      iterations:  3,
      memorySize:  32768,
      parallelism: 1,
      hashLength:  32,
      outputType:  'hex',
    });
  }

  _decodeSalt(saltValue) {
    const s = String(saltValue).trim();
    if (s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s)) return Buffer.from(s, 'hex');
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return Buffer.from(s, 'base64');
    return Buffer.from(s, 'utf8');
  }

  // ── Legacy v0 fallback (MD5 password) ──
  async _loginLegacy() {
    const md5Hex = createHash('md5').update(this._password).digest('hex');
    const url = this._baseUrl + ENDPOINTS.AUTH_V0;
    const res = await postJson(url, { user_name: this._email, password: md5Hex }, CLIENT_PROFILES[0].headers, 10000);
    if (!res.ok || !res.data) throw new Error(`Auth HTTP ${res.status}`);
    const d = res.data;
    if (String(d.status || '') !== '0' || !d.data || !d.data.token) {
      throw new Error(d.message || d.msg || 'Legacy auth failed');
    }
    return d.data.token;
  }

  async _request(path, body = {}) {
    if (!this._token) throw new Error('Not logged in');
    const url = this._baseUrl + path;
    const headers = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      ...this._profileHeaders,
      Authorization: this._token,
    };
    const res = await postJson(url, body, headers, 15000);
    if (!res.ok) throw new Error(`API ${path} HTTP ${res.status}`);
    if (!res.data || String(res.data.status ?? '0') !== '0') {
      const msg = res.data?.message || res.data?.msg || 'Unknown error';
      // Token expired / invalid → re-auth once
      if (String(res.data?.status) === '100' || msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        this._token = null;
        await this.login(this._email, this._password, this._authMode || AUTH_MODE_AUTO);
        return this._request(path, body);
      }
      throw new Error(`API ${path}: ${msg}`);
    }
    return res.data.data;
  }

  async getStations() {
    const stations = [];
    let pageNum = 1;
    const pageSize = 100;

    for (;;) {
      const data = await this._request(ENDPOINTS.STATIONS, { page_num: pageNum, page_size: pageSize });
      const list = Array.isArray(data?.list) ? data.list : [];
      if (list.length === 0) break;

      for (const s of list) {
        stations.push({
          id:     String(s.id || s.station_id),
          name:   s.name || s.station_name || `Station ${s.id}`,
          sn:     s.sn || '',
        });
      }

      const total = Number(data?.total ?? NaN);
      if (!isNaN(total) && stations.length >= total) break;
      if (list.length < pageSize) break;
      pageNum++;
    }
    return stations;
  }

  // Map numeric device type codes to names
  _deviceTypeName(node, depth) {
    const code = Number(node.type);
    const known = { 1: 'dtu', 6: 'inverter', 14: 'gateway' };
    if (known[code]) return known[code];

    const hint = String(node.model_no || node.model || '').toLowerCase();
    if (depth === 0 || /dtu|dts|stick/.test(hint)) return 'dtu';
    if (/inv|hybrid|hione|hyt/.test(hint))         return 'inverter';
    if (/hibox|gateway|backup|63t|eps/.test(hint)) return 'gateway';
    if (/bat|bms|8b|module/.test(hint))            return 'battery';
    return 'device';
  }

  // Walk the device tree recursively and flatten all nodes
  _flattenDeviceTree(node, depth) {
    if (!node || typeof node !== 'object') return [];
    const model  = String(node.model_no || node.model || node.dev_model || '').trim();
    const sn     = String(node.sn || node.dtu_sn || node.serial || node.dev_sn || '').trim();
    const connect = node.warn_data && node.warn_data.connect;
    const online  = connect === true || node.dev_status === 1 || node.status === 1;
    const out = [];
    if (model || sn) {
      out.push({
        type:     this._deviceTypeName(node, depth),
        sn,
        model,
        firmware: String(node.soft_ver || node.software_version || node.fw_version || node.firmware_version || ''),
        hardware: String(node.hard_ver || node.hardware_version || node.hw_version || ''),
        name:     String(node.dev_name || node.name || ''),
        online,
      });
    }
    const childKeys = ['child_list', 'children', 'child', 'device_list', 'sub_list', 'list'];
    for (const key of childKeys) {
      const kids = node[key];
      if (!Array.isArray(kids)) continue;
      for (const child of kids) out.push(...this._flattenDeviceTree(child, depth + 1));
    }
    return out;
  }

  /**
   * Fetch the device tree for a station using the correct endpoint.
   * Returns array of { type, sn, model, firmware, hardware, name, online }.
   * Falls back to the legacy list endpoint if the tree endpoint fails.
   */
  async getDeviceList(stationId) {
    // Primary: tree endpoint — confirmed working by the reference implementation
    try {
      const data = await this._request(ENDPOINTS.DEVICE_TREE, { id: Number(stationId) });
      if (data) {
        const roots = Array.isArray(data) ? data : [data];
        const all = [];
        for (const root of roots) all.push(...this._flattenDeviceTree(root, 0));
        // Deduplicate by SN
        const seen = new Set();
        const unique = [];
        for (const d of all) {
          const key = d.sn || `${d.type}:${d.model}`;
          if (key && seen.has(key)) continue;
          seen.add(key);
          unique.push(d);
        }
        if (unique.length > 0) return unique;
      }
    } catch (err) {
      this._error('getDeviceList (tree) failed, trying legacy:', err.message);
    }

    // Fallback: legacy flat-list endpoint
    try {
      const data = await this._request(ENDPOINTS.DEVICE_LIST, { sid: Number(stationId) });
      if (!data) return [];
      const devices = [];
      const extract = (list, type) => {
        if (!Array.isArray(list)) return;
        for (const d of list) {
          devices.push({
            type,
            sn:       d.dev_sn || d.sn || '',
            model:    d.dev_model || d.model_no || d.model || '',
            firmware: d.software_version || d.fw_version || d.firmware_version || '',
            hardware: d.hardware_version || d.hw_version || '',
            name:     d.dev_name || d.name || '',
            online:   d.dev_status === 1 || d.status === 1 || d.online === true,
          });
        }
      };
      extract(data.dtu_list || data.dtuList, 'dtu');
      extract(data.inverter_list || data.inverterList || data.pv_list, 'inverter');
      extract(data.gateway_list || data.gatewayList || data.hes_list, 'gateway');
      extract(data.battery_list || data.batteryList || data.bms_list || data.ems_list, 'battery');
      return devices;
    } catch (err) {
      this._error('getDeviceList (legacy) failed:', err.message);
      return [];
    }
  }

  async getRealData(stationId) {
    const data = await this._request(ENDPOINTS.STATION_DATA, { sid: Number(stationId) });
    if (!data) return null;

    // The real-data response nests battery/grid/load values inside reflux_station_data
    const reflux = data.reflux_station_data || {};

    const num = (...keys) => {
      for (const obj of [reflux, data]) {
        for (const k of keys) {
          const v = obj[k];
          if (v !== undefined && v !== null) {
            const n = Number(v);
            if (!isNaN(n)) return n;
          }
        }
      }
      return null;
    };

    // Energy counters are returned in Wh — convert to kWh
    const kwh = (...keys) => {
      const v = num(...keys);
      return v != null ? Math.round(v / 10) / 100 : null;
    };

    return {
      pvPower:          num('real_power', 'pv_power', 'capacitor_power'),
      // bms_power: + = charging, - = discharging (same convention as measure_power)
      batteryPower:     num('bms_power', 'battery_power', 'bat_power'),
      batterySoc:       num('bms_soc', 'battery_soc', 'soc'),
      gridPower:        num('grid_power', 'meter_power'),
      loadPower:        num('load_power', 'home_power'),
      dailyEnergy:      kwh('today_eq', 'daily_energy', 'today_energy'),
      monthlyEnergy:    kwh('month_eq', 'monthly_energy', 'month_energy'),
      yearlyEnergy:     kwh('year_eq', 'yearly_energy', 'year_energy'),
      totalEnergy:      kwh('total_eq', 'total_energy', 'lifetime_energy'),
      // co2_emission_reduction is returned in grams — convert to kg
      co2Reduction:     num('co2_emission_reduction', 'co2_reduction') != null
        ? (num('co2_emission_reduction', 'co2_reduction') / 1000)
        : null,
      profitToday:      num('today_income', 'profit_today'),
      profitTotal:      num('total_income', 'profit_total'),
      batteryChargeEnergy:    kwh('bms_in_eq', 'charge_today', 'charge_energy'),
      batteryDischargeEnergy: kwh('bms_out_eq', 'discharge_today', 'discharge_energy'),
      touMode:          num('tou_mode', 'work_mode', 'working_mode'),
      raw: data,
    };
  }

  // ── Battery settings (action 1013 async pattern) ─────────────────────────

  /**
   * Read full battery settings via the async pvm-ctl endpoint (action 1013).
   * Returns { mode, reserveSoc, maxSoc, maxChargePower, maxDischargePower,
   *           meterPower, availableModes, modeData } or null.
   */
  async readBatterySetting(stationId) {
    try {
      let resolved = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const submitted = await this._request(ENDPOINTS.SETTING_READ, {
            action: BATTERY_SETTINGS_ACTION_ID,
            data: { sid: Number(stationId) },
          });
          resolved = await this._resolveSettingJob(submitted);
          break;
        } catch (err) {
          if (/pending/i.test(err.message) && attempt < 3) {
            await new Promise(r => setTimeout(r, 3000));
            continue;
          }
          throw err;
        }
      }
      const payload = resolved && resolved.data && resolved.data.data;
      if (!payload || typeof payload !== 'object') return null;

      const mode = Number(payload.mode || 1);
      const modeData = payload.data || {};
      const modeKey = MODE_KEYS[mode];
      const current = (modeKey && modeData[modeKey]) || {};
      const forceCharge = modeData['k_5'] || {};
      const forceDischarge = modeData['k_6'] || {};

      const availableModes = Object.entries(MODE_KEYS)
        .filter(([, key]) => key in modeData)
        .map(([id]) => Number(id));

      return {
        mode: String(mode),
        reserveSoc: this._pct(current.reserve_soc),
        maxSoc: this._pct(current.max_soc),
        maxChargePower: this._pct(forceCharge.max_power),
        maxDischargePower: this._pct(forceDischarge.max_power),
        meterPower: current.meter_power != null ? Number(current.meter_power) : null,
        availableModes,
        modeData,
      };
    } catch (err) {
      this._log('readBatterySetting failed: ' + err.message);
      return null;
    }
  }

  /**
   * Resolve an async pvm-ctl job: polls until it stops RUNNING.
   */
  async _resolveSettingJob(response) {
    const data = response && response.data;
    if (typeof data !== 'string' && typeof data !== 'number') return response;

    for (let attempt = 0; attempt < SETTING_MAX_POLLS; attempt++) {
      await new Promise(r => setTimeout(r, SETTING_POLL_INTERVAL_MS));
      const status = await this._request(ENDPOINTS.SETTING_STATUS, { id: String(data) });
      const code = status && status.data && status.data.code;
      if (code !== SETTING_STATUS_RUNNING) {
        if (code !== undefined && code !== null && code !== SETTING_STATUS_SUCCESS) {
          throw new Error('Setting command failed (code ' + code + ')');
        }
        return status;
      }
    }
    throw new Error('Timed out waiting for setting command');
  }

  /**
   * Write battery mode + settings. Performs read-merge-write to preserve
   * existing per-mode settings.
   */
  async _writeBatteryMode(stationId, modeNum, settingsUpdate, current) {
    if (!current) current = await this.readBatterySetting(stationId);
    const modeKey = MODE_KEYS[modeNum];
    const existing = (current && current.modeData && current.modeData[modeKey]) || {};
    const merged = Object.assign({}, existing, settingsUpdate);

    const submitted = await this._request(ENDPOINTS.SETTING_WRITE, {
      action: BATTERY_SETTINGS_ACTION_ID,
      data: { sid: Number(stationId), data: { mode: modeNum, data: merged } },
    });
    return this._resolveSettingJob(submitted);
  }

  async setBatteryMode(stationId, dtuSn, mode) {
    const modeNum = Number(mode);
    return this._writeBatteryMode(stationId, modeNum, {});
  }

  async setReserveSoc(stationId, dtuSn, soc) {
    const current = await this.readBatterySetting(stationId);
    const modeNum = current ? Number(current.mode) : 1;
    return this._writeBatteryMode(stationId, modeNum, { reserve_soc: Math.round(Number(soc)) }, current);
  }

  async setMaxSoc(stationId, dtuSn, soc) {
    const current = await this.readBatterySetting(stationId);
    const modeNum = current ? Number(current.mode) : 7;
    return this._writeBatteryMode(stationId, modeNum, { max_soc: Math.round(Number(soc)) }, current);
  }

  async setMaxChargePower(stationId, dtuSn, power) {
    return this._writeBatteryMode(stationId, 5, { max_power: Math.round(Number(power)) });
  }

  async setMaxDischargePower(stationId, dtuSn, power) {
    return this._writeBatteryMode(stationId, 6, { max_power: Math.round(Number(power)) });
  }

  async setPeakShaving(stationId, dtuSn, { reserveSoc, maxSoc, gridLimit }) {
    const updates = {};
    if (reserveSoc != null) updates.reserve_soc = Math.round(Number(reserveSoc));
    if (maxSoc != null) updates.max_soc = Math.round(Number(maxSoc));
    if (gridLimit != null) updates.meter_power = Math.round(Number(gridLimit));
    return this._writeBatteryMode(stationId, 7, updates);
  }

  async setTouPeriod(stationId, dtuSn, params) {
    const period = {
      cs_time:        String(params.chargeFrom),
      ce_time:        String(params.chargeTo),
      c_power:        Math.round(Number(params.chargePower)),
      dcs_time:       String(params.dischargeFrom),
      dce_time:       String(params.dischargeTo),
      dc_power:       Math.round(Number(params.dischargePower)),
      charge_soc:     Math.round(Number(params.chargeSoc)),
      dis_charge_soc: Math.round(Number(params.dischargeSoc)),
    };
    return this._writeBatteryMode(stationId, 8, { time: [period] });
  }

  async setRelayEnabled(stationId, dtuSn, enabled) {
    // Relay uses a different action ID — keep simple write approach
    const submitted = await this._request(ENDPOINTS.SETTING_WRITE, {
      action: 1014,
      data: { sid: Number(stationId), data: { mode: enabled ? 1 : 0 } },
    });
    return this._resolveSettingJob(submitted);
  }

  async setGridLimit(stationId, dtuSn, watts) {
    return this._writeBatteryMode(stationId, 7, { meter_power: Math.round(Number(watts)) });
  }

  // Percentage field — the cloud returns some values (e.g. max_power) in 0.01%
  // units (67% → 6700). Values above 100 are scaled back to a real percent.
  _pct(v) {
    if (v === null || v === undefined) return null;
    const n = parseFloat(v);
    if (isNaN(n)) return null;
    return n > 100 ? Math.round(n / 100) : Math.round(n);
  }
}

module.exports = {
  HoymilesApi,
  BATTERY_MODES,
  ENDPOINTS,
  BASE_URL_GLOBAL,
  BASE_URL_EU,
  AUTH_MODE_AUTO,
  AUTH_MODE_WEB_V3,
  AUTH_MODE_INSTALLER_V3,
  AUTH_MODE_HOME_V3,
  AUTH_MODE_LEGACY_V0,
};
