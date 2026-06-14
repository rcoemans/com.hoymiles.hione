'use strict';

/**
 * DISCLAIMER
 * ----------
 * This library communicates with the Hoymiles S-Miles Cloud API.
 * This is an UNOFFICIAL integration — not affiliated with, endorsed by,
 * or supported by Hoymiles Power Electronics Inc.
 *
 * The API is reverse-engineered from observed S-Miles Cloud behaviour.
 * Hoymiles may change or discontinue this API at any time without notice.
 * Use at your own risk.
 *
 * Credentials are stored in Homey's encrypted device store and are only
 * transmitted to the official Hoymiles S-Miles Cloud API (neapi.hoymiles.com).
 */

const { createHash } = require('crypto');

const DEFAULT_BASE_URL = 'https://neapi.hoymiles.com';

const ENDPOINTS = {
  LOGIN:       '/iam/pub/0/auth/login',
  STATIONS:    '/pvm/api/0/station/select_by_page',
  REAL_DATA:   '/pvm-data/api/0/station/data/count_station_real_data',
  ENERGY_DATA: '/pvm-data/api/0/station/data_fd/stat_g_a',
  SET_MODE:    '/pvm-ctl/api/0/dev/setting/write',
};

const BATTERY_MODES = { 0:'Self-Consumption', 1:'Economy', 2:'Backup', 3:'Off-Grid', 4:'Peak Shaving', 5:'Time of Use' };
const TOKEN_LIFETIME_MS = 23 * 60 * 60 * 1000; // refresh before 24h expiry

class HoymilesApi {

  constructor({ log, error, baseUrl }) {
    this.log   = log;
    this.error = error;
    this._baseUrl     = baseUrl || DEFAULT_BASE_URL;
    this._token       = null;
    this._tokenExpiry = null;
  }

  // ── Authentication ────────────────────────────────────────────────────────

  async login(email, password) {
    if (!email || !password) throw new Error('Email and password are required');
    const passwordHash = createHash('md5').update(password).digest('hex');

    const response = await this._request('POST', ENDPOINTS.LOGIN,
      { user_name: email, password: passwordHash }, false);

    const token = response?.data?.token;
    if (!token) throw new Error('Login failed — check your S-Miles Cloud email and password');

    this._token       = token;
    this._tokenExpiry = Date.now() + TOKEN_LIFETIME_MS;
    this.log('[HoymilesApi] Login successful');
    return true;
  }

  async ensureToken(email, password) {
    if (!this._token || Date.now() >= (this._tokenExpiry ?? 0)) {
      await this.login(email, password);
    }
  }

  // ── Stations ──────────────────────────────────────────────────────────────

  async getStations() {
    const response = await this._request('POST', ENDPOINTS.STATIONS, { page_num: 1, page_size: 100 });
    const list = response?.data?.list;
    if (!Array.isArray(list)) throw new Error('Unexpected response from stations endpoint');
    return list.map(s => ({ id: String(s.id), name: s.name || `Station ${s.id}`, sn: s.sn || '' }));
  }

  // ── Real-time data ────────────────────────────────────────────────────────

  async getRealData(stationId) {
    const response = await this._request('POST', ENDPOINTS.REAL_DATA, { sid: Number(stationId) });
    const d = response?.data;
    if (!d) throw new Error('Empty real-data response');

    return {
      pvPower:      this._num(d.pv_power      ?? d.real_power     ?? d.pvPower      ?? 0),
      batteryPower: this._num(d.battery_power ?? d.es_power       ?? d.batteryPower ?? 0),
      batterySoc:   this._num(d.battery_soc   ?? d.es_soc         ?? d.batterySoc   ?? 0),
      gridPower:    this._num(d.grid_power    ?? d.meter_power    ?? d.gridPower    ?? 0),
      loadPower:    this._num(d.load_power    ?? d.home_load_power ?? d.loadPower   ?? 0),
      batteryMode:  String(d.work_mode ?? d.workMode ?? 0),
    };
  }

  // ── Energy totals ─────────────────────────────────────────────────────────

  async getEnergyData(stationId) {
    try {
      const now = new Date();
      const response = await this._request('POST', ENDPOINTS.ENERGY_DATA, {
        sid:  Number(stationId),
        mode: 1,
        date: now.toISOString().split('T')[0],
        type: 6,
      });
      const d = response?.data;
      return {
        dailyEnergy: this._num(d?.today_eq   ?? d?.co_energy ?? d?.dailyEnergy ?? 0),
        totalEnergy: this._num(d?.total_eq   ?? d?.totalEnergy ?? 0),
      };
    } catch (_) {
      return { dailyEnergy: 0, totalEnergy: 0 };
    }
  }

  // ── Control ───────────────────────────────────────────────────────────────

  async setBatteryMode(stationId, mode) {
    const modeNum = Number(mode);
    if (!(modeNum in BATTERY_MODES)) throw new Error(`Invalid battery mode: ${mode}`);
    await this._request('POST', ENDPOINTS.SET_MODE, { sid: Number(stationId), action_id: 1013, data: JSON.stringify({ work_mode: modeNum }) });
    this.log(`[HoymilesApi] Mode → ${BATTERY_MODES[modeNum]} for station ${stationId}`);
    return true;
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async _request(method, endpoint, body = {}, authenticated = true) {
    const url     = `${this._baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
      'Source':       '1',
    };
    if (authenticated && this._token) headers['Authorization'] = this._token;

    this.log(`[HoymilesApi] ${method} ${endpoint}`);

    let rawResponse;
    try {
      rawResponse = await fetch(url, {
        method,
        headers,
        body:   JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Network error on ${endpoint}: ${err.message}`);
    }

    if (!rawResponse.ok) throw new Error(`HTTP ${rawResponse.status} on ${endpoint}`);

    let json;
    try {
      json = await rawResponse.json();
    } catch (_) {
      throw new Error(`Invalid JSON from ${endpoint}`);
    }

    if (String(json.status ?? '0') !== '0') {
      throw new Error(`API error on ${endpoint}: ${json.message ?? `status ${json.status}`}`);
    }

    return json;
  }

  _num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
}

module.exports = HoymilesApi;
module.exports.BATTERY_MODES = BATTERY_MODES;
