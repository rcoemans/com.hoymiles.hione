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
  DEVICE_LIST:   '/pvm-data/api/0/station/data/count_device_by_station',
  ENERGY_DATA:   '/pvm-data/api/0/station/data/count_eq_by_station',
  SETTING_READ:  '/pvm-ctl/api/0/dev/setting/read',
  SETTING_WRITE: '/pvm-ctl/api/0/dev/setting/write',
  JOB_STATUS:    '/pvm-ctl/api/0/dev/setting/read_status',
};

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

  async getDeviceList(stationId) {
    // Try both common parameter names for station ID
    let data = await this._request(ENDPOINTS.DEVICE_LIST, {
      sid:        Number(stationId),
      station_id: Number(stationId),
    }).catch(() => null);
    if (!data) {
      data = await this._request(ENDPOINTS.DEVICE_LIST, { sid: Number(stationId) });
    }
    if (!data) return [];
    const devices = [];
    const extract = (list, type) => {
      if (!Array.isArray(list)) return;
      for (const d of list) {
        devices.push({
          type,
          sn:       d.dev_sn || d.sn || d.device_sn || '',
          model:    d.dev_model || d.model_no || d.model || d.device_model || '',
          firmware: d.software_version || d.fw_version || d.firmware_version || d.soft_version || '',
          hardware: d.hardware_version || d.hw_version || '',
          name:     d.dev_name || d.name || d.device_name || '',
          online:   d.dev_status === 1 || d.status === 1 || d.online === true || d.connect_status === 1,
        });
      }
    };
    extract(data.dtu_list || data.dtuList || data.dtu, 'dtu');
    extract(data.inverter_list || data.inverterList || data.pv_list || data.microInverterList, 'inverter');
    extract(data.gateway_list || data.gatewayList || data.hes_list || data.hesList, 'gateway');
    extract(data.battery_list || data.batteryList || data.bms_list || data.bmsList || data.ems_list || data.emsList, 'battery');
    // Fallback: if the response is an array itself
    if (Array.isArray(data)) {
      for (const d of data) {
        const type = d.type || d.device_type || d.dev_type || 'unknown';
        devices.push({
          type,
          sn:       d.dev_sn || d.sn || d.device_sn || '',
          model:    d.dev_model || d.model_no || d.model || '',
          firmware: d.software_version || d.fw_version || d.firmware_version || '',
          hardware: d.hardware_version || d.hw_version || '',
          name:     d.dev_name || d.name || '',
          online:   d.dev_status === 1 || d.status === 1 || d.online === true,
        });
      }
    }
    return devices;
  }

  async getRealData(stationId) {
    const data = await this._request(ENDPOINTS.STATION_DATA, { sid: Number(stationId) });
    if (!data) return null;
    const findVal = (...keys) => {
      for (const k of keys) {
        if (data[k] !== undefined && data[k] !== null) return Number(data[k]);
      }
      return null;
    };
    return {
      pvPower:          findVal('pv_power', 'real_power', 'capacitor_power'),
      batteryPower:     findVal('bms_power', 'battery_power', 'bat_power'),
      batterySoc:       findVal('bms_soc', 'battery_soc', 'soc'),
      gridPower:        findVal('grid_power', 'meter_power'),
      loadPower:        findVal('load_power', 'home_power'),
      dailyEnergy:      findVal('today_eq', 'daily_energy', 'today_energy'),
      monthlyEnergy:    findVal('month_eq', 'monthly_energy', 'month_energy'),
      yearlyEnergy:     findVal('year_eq', 'yearly_energy', 'year_energy'),
      totalEnergy:      findVal('total_eq', 'total_energy', 'lifetime_energy'),
      co2Reduction:     findVal('co2_emission_reduction', 'co2_reduction'),
      profitToday:      findVal('today_income', 'profit_today'),
      profitTotal:      findVal('total_income', 'profit_total'),
      batteryChargeEnergy:    findVal('charge_today', 'charge_energy'),
      batteryDischargeEnergy: findVal('discharge_today', 'discharge_energy'),
      touMode:          findVal('tou_mode', 'work_mode', 'working_mode'),
      raw: data,
    };
  }

  async getEnergyData(stationId) {
    const data = await this._request(ENDPOINTS.ENERGY_DATA, { sid: Number(stationId) });
    return data || {};
  }

  async readBatterySetting(stationId, dtuSn) {
    const data = await this._request(ENDPOINTS.SETTING_READ, {
      sid:    Number(stationId),
      dev_sn: dtuSn,
      type:   'energy_storage',
    });
    if (!data || !data.job_id) return null;
    return this._pollJob(data.job_id);
  }

  async writeBatterySetting(stationId, dtuSn, settings) {
    const data = await this._request(ENDPOINTS.SETTING_WRITE, {
      sid:    Number(stationId),
      dev_sn: dtuSn,
      type:   'energy_storage',
      ...settings,
    });
    return data;
  }

  async _pollJob(jobId, maxAttempts = 10, intervalMs = 3000) {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(r => setTimeout(r, intervalMs));
      try {
        const data = await this._request(ENDPOINTS.JOB_STATUS, { job_id: jobId });
        if (data && data.status === 'completed') return data.result || data;
        if (data && data.status === 'failed') throw new Error('Job failed: ' + (data.message || ''));
      } catch (err) {
        if (i === maxAttempts - 1) throw err;
      }
    }
    throw new Error('Job polling timed out');
  }

  async setBatteryMode(stationId, dtuSn, mode) {
    return this.writeBatterySetting(stationId, dtuSn, { working_mode: Number(mode) });
  }

  async setReserveSoc(stationId, dtuSn, soc) {
    return this.writeBatterySetting(stationId, dtuSn, { reserve_soc: Number(soc) });
  }

  async setMaxSoc(stationId, dtuSn, soc) {
    return this.writeBatterySetting(stationId, dtuSn, { max_soc: Number(soc) });
  }

  async setMaxChargePower(stationId, dtuSn, power) {
    return this.writeBatterySetting(stationId, dtuSn, {
      working_mode: 5,
      charge_power: Number(power),
    });
  }

  async setMaxDischargePower(stationId, dtuSn, power) {
    return this.writeBatterySetting(stationId, dtuSn, {
      working_mode: 6,
      discharge_power: Number(power),
    });
  }

  async setPeakShaving(stationId, dtuSn, { reserveSoc, maxSoc, gridLimit }) {
    return this.writeBatterySetting(stationId, dtuSn, {
      working_mode: 7,
      reserve_soc:  Number(reserveSoc),
      max_soc:      Number(maxSoc),
      meter_power:  Number(gridLimit),
    });
  }

  async setTouPeriod(stationId, dtuSn, params) {
    return this.writeBatterySetting(stationId, dtuSn, {
      working_mode: 8,
      charge_start:     params.chargeFrom,
      charge_end:       params.chargeTo,
      charge_power:     Number(params.chargePower),
      charge_soc:       Number(params.chargeSoc),
      discharge_start:  params.dischargeFrom,
      discharge_end:    params.dischargeTo,
      discharge_power:  Number(params.dischargePower),
      discharge_soc:    Number(params.dischargeSoc),
    });
  }

  async setRelayEnabled(stationId, dtuSn, enabled) {
    return this.writeBatterySetting(stationId, dtuSn, { relay_enabled: enabled ? 1 : 0 });
  }

  async setGridLimit(stationId, dtuSn, watts) {
    return this.writeBatterySetting(stationId, dtuSn, {
      working_mode: 7,
      meter_power: Number(watts),
    });
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
