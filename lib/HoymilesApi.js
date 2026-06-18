'use strict';

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
  AUTH_V3:       '/iam/pub/3/auth/login',
  AUTH_V0:       '/iam/pub/0/auth/login',
  STATIONS:      '/pvm-data/api/0/station/select_by_condition',
  STATION_DATA:  '/pvm-data/api/0/station/data/count_station_real_data',
  DEVICE_LIST:   '/pvm-data/api/0/station/data/count_device_by_station',
  ENERGY_DATA:   '/pvm-data/api/0/station/data/count_eq_by_station',
  SETTING_READ:  '/pvm-ctl/api/0/dev/setting/read',
  SETTING_WRITE: '/pvm-ctl/api/0/dev/setting/write',
  JOB_STATUS:    '/pvm-ctl/api/0/dev/setting/read_status',
};

const AUTH_PROFILES = {
  [AUTH_MODE_WEB_V3]: {
    authPath: ENDPOINTS.AUTH_V3,
    baseUrl:  BASE_URL_GLOBAL,
    headers:  { 'User-Agent': 'HomeAssistant-HoymilesCloud' },
  },
  [AUTH_MODE_INSTALLER_V3]: {
    authPath: ENDPOINTS.AUTH_V3,
    baseUrl:  BASE_URL_GLOBAL,
    headers:  { 'User-Agent': 'S-Miles Installer/3.7.1', 'App-Version': '3.7.1' },
  },
  [AUTH_MODE_HOME_V3]: {
    authPath: ENDPOINTS.AUTH_V3,
    baseUrl:  BASE_URL_EU,
    headers:  { 'User-Agent': 'sma/ad/2.10.0/159/0' },
  },
  [AUTH_MODE_LEGACY_V0]: {
    authPath: ENDPOINTS.AUTH_V0,
    baseUrl:  BASE_URL_GLOBAL,
    headers:  { 'User-Agent': 'HomeAssistant-HoymilesCloud' },
  },
};

const AUTO_ORDER = [AUTH_MODE_WEB_V3, AUTH_MODE_INSTALLER_V3, AUTH_MODE_HOME_V3, AUTH_MODE_LEGACY_V0];

class HoymilesApi {
  constructor({ log = console.log, error = console.error, baseUrl = null } = {}) {
    this._log     = log;
    this._error   = error;
    this._baseUrl = baseUrl || BASE_URL_GLOBAL;
    this._token   = null;
    this._email   = null;
    this._password = null;
    this._authMode = null;
  }

  get isLoggedIn() { return !!this._token; }

  async login(email, password, mode = AUTH_MODE_AUTO) {
    this._email    = email;
    this._password = password;

    const modes = mode === AUTH_MODE_AUTO ? AUTO_ORDER : [mode];
    let lastError = null;

    for (const m of modes) {
      try {
        await this._tryLogin(m);
        this._authMode = m;
        this._log(`Login succeeded with mode: ${m}`);
        return;
      } catch (err) {
        lastError = err;
        this._log(`Login mode ${m} failed: ${err.message}`);
      }
    }
    throw lastError || new Error('All login modes failed');
  }

  async _tryLogin(mode) {
    const profile  = AUTH_PROFILES[mode];
    const isLegacy = mode === AUTH_MODE_LEGACY_V0;
    const url      = profile.baseUrl + profile.authPath;

    let passwordHash;
    if (isLegacy) {
      const crypto = require('crypto');
      passwordHash = crypto.createHash('md5').update(this._password).digest('hex');
    } else {
      passwordHash = this._password;
    }

    const body = {
      user_name: this._email,
      password:  passwordHash,
    };

    const res = await postJson(url, body, profile.headers, 10000);

    if (!res.ok || !res.data) {
      throw new Error(`Auth HTTP ${res.status}`);
    }

    const d = res.data;

    if (d.status === '0' && d.data && d.data.token) {
      this._token = d.data.token;
      return;
    }

    if (d.status === '1' && !isLegacy && d.data && d.data.salt) {
      await this._handleArgon2Challenge(d.data, profile, url);
      return;
    }

    const msg = d.message || d.msg || JSON.stringify(d);
    throw new Error(`Auth failed: ${msg}`);
  }

  async _handleArgon2Challenge(challengeData, profile, url) {
    const { argon2id } = require('hash-wasm');
    const salt = challengeData.salt;

    let saltBytes;
    if (/^[0-9a-fA-F]+$/.test(salt) && salt.length % 2 === 0) {
      saltBytes = Buffer.from(salt, 'hex');
    } else {
      try { saltBytes = Buffer.from(salt, 'base64'); } catch (_) { saltBytes = Buffer.from(salt, 'utf-8'); }
    }

    const hash = await argon2id({
      password:    this._password,
      salt:        saltBytes,
      parallelism: 1,
      iterations:  3,
      memorySize:  32768,
      hashLength:  32,
      outputType:  'hex',
    });

    const body = {
      user_name: this._email,
      password:  hash,
    };

    const res = await postJson(url, body, profile.headers, 10000);

    if (!res.ok || !res.data) throw new Error(`Argon2 auth HTTP ${res.status}`);
    if (res.data.status !== '0' || !res.data.data || !res.data.data.token) {
      throw new Error(`Argon2 auth failed: ${res.data.message || JSON.stringify(res.data)}`);
    }

    this._token = res.data.data.token;
  }

  async _request(path, body = {}) {
    if (!this._token) throw new Error('Not logged in');
    const url = this._baseUrl + path;
    const headers = {
      Authorization: `Bearer ${this._token}`,
      'Content-Type': 'application/json',
    };
    const res = await postJson(url, body, headers, 15000);
    if (!res.ok) throw new Error(`API ${path} HTTP ${res.status}`);
    if (!res.data || res.data.status !== '0') {
      const msg = res.data?.message || res.data?.msg || 'Unknown error';
      if (msg.includes('token') || msg.includes('expired') || msg.includes('unauthorized')) {
        this._token = null;
        await this.login(this._email, this._password, this._authMode || AUTH_MODE_AUTO);
        return this._request(path, body);
      }
      throw new Error(`API ${path}: ${msg}`);
    }
    return res.data.data;
  }

  async getStations() {
    const data = await this._request(ENDPOINTS.STATIONS, { page: 1, page_size: 100 });
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.map(s => ({
      id:     String(s.id || s.station_id),
      name:   s.station_name || s.name || `Station ${s.id}`,
      plantId: String(s.id || s.station_id),
    }));
  }

  async getDeviceList(stationId) {
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
    extract(data.gateway_list || data.gatewayList, 'gateway');
    extract(data.battery_list || data.batteryList || data.bms_list, 'battery');
    if (data.hes_list) extract(data.hes_list, 'gateway');
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
