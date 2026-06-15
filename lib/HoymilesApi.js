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
 *
 * Authentication flow based on Philra94/homeassistant-hoymiles-cloud (reference).
 */

const { createHash } = require('crypto');

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'https://neapi.hoymiles.com';

const AUTH_PATHS = {
  PRE_INSP_V3: '/iam/pub/3/auth/pre-insp',
  LOGIN_V3:    '/iam/pub/3/auth/login',
  LOGIN_V0:    '/iam/pub/0/auth/login',
};

const ENDPOINTS = {
  USER_ME:     '/iam/api/1/user/me',
  STATIONS:    '/pvm/api/0/station/select_by_page',
  REAL_DATA:   '/pvm-data/api/0/station/data/count_station_real_data',
  ENERGY_DATA: '/pvm-data/api/0/station/data_fd/stat_g_a',
  SET_MODE:    '/pvm-ctl/api/0/dev/setting/write',
};

const BATTERY_MODES = {
  0: 'Self-Consumption', 1: 'Economy', 2: 'Backup',
  3: 'Off-Grid', 4: 'Peak Shaving', 5: 'Time of Use',
};

const TOKEN_LIFETIME_MS = 7200 * 1000; // 2 hours, per reference implementation

// ─── Auth profiles ───────────────────────────────────────────────────────────

const AUTH_MODE_AUTO         = 'auto';
const AUTH_MODE_WEB_V3       = 'web_v3';
const AUTH_MODE_INSTALLER_V3 = 'installer_v3';
const AUTH_MODE_LEGACY_V0    = 'legacy_v0';

const PROFILES = {
  web: {
    userAgent:    'HomeAssistant-HoymilesCloud',
    appVersion:   null,
    xClientType:  null,
    baseUrl:      DEFAULT_BASE_URL,
  },
  installer: {
    userAgent:    'S-Miles Installer',
    appVersion:   '3.7.1',
    xClientType:  'mobile',
    baseUrl:      DEFAULT_BASE_URL,
  },
};

const AUTH_MODE_TO_PROFILE = {
  [AUTH_MODE_WEB_V3]:       'web',
  [AUTH_MODE_INSTALLER_V3]: 'installer',
};

// ─── Main class ──────────────────────────────────────────────────────────────

class HoymilesApi {

  constructor({ log, error, baseUrl }) {
    this.log   = log;
    this.error = error;
    this._baseUrl       = (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this._token         = null;
    this._tokenExpiry   = 0;
    this._activeProfile = 'web';
    this._activeAppVer  = null;
    this._username      = null;
    this._password      = null;
    this._lastAuthAttempts = [];
  }

  // ── Authentication (public) ────────────────────────────────────────────────

  /**
   * Authenticate using a matrix of auth modes.
   * Tries v3 flows first (web, installer), then falls back to legacy v0.
   * Returns { success, mode, profile, message } on success.
   * Throws HoymilesAuthError with diagnostics on failure.
   */
  async authenticate(username, password, { mode = AUTH_MODE_AUTO } = {}) {
    if (!username || !password) throw new Error('Email and password are required');
    this._username = username.trim();
    this._password = password;
    this._lastAuthAttempts = [];

    const attempts = this._buildAuthAttempts(mode);

    for (const attempt of attempts) {
      let result;
      if (attempt.mode === AUTH_MODE_LEGACY_V0) {
        result = await this._authenticateLegacyV0();
      } else {
        result = await this._authenticateV3(attempt.profile);
      }
      this._lastAuthAttempts.push(result);

      if (result.success) {
        this._token       = result.token;
        this._tokenExpiry = Date.now() + TOKEN_LIFETIME_MS;
        this._activeProfile = result.profile;
        this._activeAppVer  = result.appVersion || null;
        this.log(`[HoymilesApi] Auth succeeded via ${result.mode}/${result.profile}${result.variant ? ':' + result.variant : ''}`);
        return result;
      }
    }

    // All attempts failed — pick the most informative failure
    const best = this._chooseBestFailure(this._lastAuthAttempts);
    const summary = this._lastAuthAttempts.map(a =>
      `${a.mode}[${a.profile}]${a.variant ? '(' + a.variant + ')' : ''} → ${a.success ? 'ok' : (a.status || '?') + ':' + (a.message || '<no message>')}`
    ).join('; ');
    this.log('[HoymilesApi] Auth failed. Attempts: ' + summary);

    throw new HoymilesAuthError(
      best ? this._userFriendlyAuthMessage(best) : 'All authentication methods failed',
      { attempts: this._sanitizedAttempts(), bestFailure: best }
    );
  }

  /**
   * Legacy login — kept for backward compatibility with existing callers.
   * Now delegates to authenticate() with auto mode.
   */
  async login(email, password) {
    const result = await this.authenticate(email, password, { mode: AUTH_MODE_AUTO });
    return result.success;
  }

  async ensureToken(email, password) {
    if (!this._token || Date.now() >= this._tokenExpiry) {
      await this.authenticate(email, password);
    }
  }

  /**
   * Return sanitized auth attempt list (safe for logging, no secrets).
   */
  getSanitizedAuthSummary() {
    return this._sanitizedAttempts();
  }

  // ── v3 Authentication ──────────────────────────────────────────────────────

  async _authenticateV3(profileName) {
    const profile    = PROFILES[profileName];
    const modeName   = Object.entries(AUTH_MODE_TO_PROFILE).find(([, p]) => p === profileName)?.[0] || 'v3';
    const appVersion = profile.appVersion;
    const headers    = this._jsonHeaders(profileName, appVersion);
    const baseUrl    = profile.baseUrl || this._baseUrl;

    // Step 1: Pre-inspection
    const preInspUrl = `${baseUrl}${AUTH_PATHS.PRE_INSP_V3}`;
    let preResp;
    try {
      preResp = await this._postRaw(preInspUrl, { u: this._username }, headers);
    } catch (err) {
      return this._makeAttempt(modeName, profileName, false, null, `Pre-inspection request failed: ${err.message}`, appVersion);
    }

    const { status: preStatus, message: preMessage, data: preData } = this._parsePreInspResponse(preResp);
    if (preStatus !== null && preStatus !== '0') {
      return this._makeAttempt(modeName, profileName, false, preStatus, preMessage, appVersion);
    }

    const nonce = preData?.n;
    if (!nonce) {
      return this._makeAttempt(modeName, profileName, false, null,
        `Pre-inspection returned incomplete data (keys: ${Object.keys(preData || {}).sort().join(',')})`, appVersion);
    }

    const salt = preData?.a;
    const loginUrl = `${baseUrl}${AUTH_PATHS.LOGIN_V3}`;

    // Step 2: Build credential hash and login
    if (salt) {
      // Argon2id required — not available in Homey runtime
      this.log(`[HoymilesApi] ${modeName}/${profileName}: Argon2id salt detected but unavailable`);
      return this._makeAttempt(modeName, profileName, false, null,
        'This account requires Argon2id authentication which is not available in this runtime. Try a different account type or use the S-Miles Installer app credentials.', appVersion);
    }

    // No salt — try observed unsalted hash variants
    const candidates = this._buildUnsaltedV3Candidates();
    let lastFailure = null;

    for (let i = 0; i < candidates.length; i++) {
      const { variant, ch } = candidates[i];

      // Get fresh nonce for retries (nonce is single-use)
      let currentNonce = nonce;
      if (i > 0) {
        try {
          const retryPre = await this._postRaw(preInspUrl, { u: this._username }, headers);
          const parsed = this._parsePreInspResponse(retryPre);
          if (parsed.data?.n) currentNonce = parsed.data.n;
        } catch (_) {
          // Use the previous nonce as fallback
        }
      }

      try {
        const loginResp = await this._postRaw(loginUrl, { u: this._username, ch, n: currentNonce }, headers);

        if (loginResp?.status === '0' && loginResp?.message === 'success') {
          const token = loginResp?.data?.token;
          if (token) {
            const attempt = this._makeAttempt(modeName, profileName, true, '0', 'success', appVersion, variant);
            attempt.token = token;
            return attempt;
          }
        }

        lastFailure = this._makeAttempt(modeName, profileName, false,
          String(loginResp?.status ?? ''), loginResp?.message, appVersion, variant);

        // If it's a credential hash variant issue, try next candidate
        if (this._shouldRetryUnsaltedVariant(loginResp?.status, loginResp?.message)) {
          continue;
        }
        return lastFailure;
      } catch (err) {
        lastFailure = this._makeAttempt(modeName, profileName, false, null, `Login request failed: ${err.message}`, appVersion, variant);
      }
    }

    return lastFailure || this._makeAttempt(modeName, profileName, false, null, 'No v3 auth candidates succeeded', appVersion);
  }

  // ── Legacy v0 Authentication ───────────────────────────────────────────────

  async _authenticateLegacyV0() {
    const headers  = this._jsonHeaders('web');
    const md5pass  = createHash('md5').update(this._password).digest('hex');
    const url      = `${this._baseUrl}${AUTH_PATHS.LOGIN_V0}`;

    try {
      const resp = await this._postRaw(url, { user_name: this._username, password: md5pass }, headers);

      if (resp?.status === '0' && resp?.message === 'success') {
        const token = resp?.data?.token;
        if (token) {
          const attempt = this._makeAttempt(AUTH_MODE_LEGACY_V0, 'web', true, '0', 'success');
          attempt.token = token;
          return attempt;
        }
      }

      return this._makeAttempt(AUTH_MODE_LEGACY_V0, 'web', false,
        String(resp?.status ?? ''), resp?.message);
    } catch (err) {
      return this._makeAttempt(AUTH_MODE_LEGACY_V0, 'web', false, null, `Legacy login request failed: ${err.message}`);
    }
  }

  // ── Auth helpers ───────────────────────────────────────────────────────────

  _buildAuthAttempts(mode) {
    if (mode === AUTH_MODE_LEGACY_V0)    return [{ mode: AUTH_MODE_LEGACY_V0, profile: 'web' }];
    if (mode === AUTH_MODE_WEB_V3)       return [{ mode: AUTH_MODE_WEB_V3, profile: 'web' }];
    if (mode === AUTH_MODE_INSTALLER_V3) return [{ mode: AUTH_MODE_INSTALLER_V3, profile: 'installer' }];

    // auto: try v3 profiles first, then legacy v0
    return [
      { mode: AUTH_MODE_WEB_V3,       profile: 'web' },
      { mode: AUTH_MODE_INSTALLER_V3, profile: 'installer' },
      { mode: AUTH_MODE_LEGACY_V0,    profile: 'web' },
    ];
  }

  _buildUnsaltedV3Candidates() {
    const md5hex  = createHash('md5').update(this._password).digest('hex');
    const sha256b64 = createHash('sha256').update(this._password).digest('base64');
    const sha256hex = createHash('sha256').update(this._password).digest('hex');
    return [
      { variant: 'sha256_v3',     ch: `${md5hex}.${sha256b64}` },
      { variant: 'sha256_hex_v3', ch: sha256hex },
    ];
  }

  _shouldRetryUnsaltedVariant(status, message) {
    const text = (message || '').toLowerCase();
    return text.includes('invalid credentials')
      || text.includes('log in failed')
      || text.includes('check your account and password')
      || String(status) === '7';
  }

  _parsePreInspResponse(payload) {
    if (!payload) return { status: null, message: null, data: {} };
    // Standard shape: { status, message, data: { a, n } }
    if ('status' in payload || 'data' in payload) {
      const status  = payload.status != null ? String(payload.status) : null;
      const message = payload.message || null;
      const data    = (typeof payload.data === 'object' && payload.data) ? payload.data : {};
      return { status, message, data };
    }
    // Alternative: top-level { a, n, u }
    if ('a' in payload || 'n' in payload || 'u' in payload) {
      return { status: '0', message: 'success', data: payload };
    }
    return { status: null, message: payload.message || null, data: {} };
  }

  _makeAttempt(mode, profile, success, status, message, appVersion, variant) {
    return { mode, profile, success, status: status || null, message: message || null, appVersion: appVersion || null, variant: variant || null, token: null };
  }

  _chooseBestFailure(attempts) {
    if (!attempts.length) return null;
    const failed = attempts.filter(a => !a.success);
    if (!failed.length) return null;

    // Priority: app-version errors > account-family errors > credential errors > unknown
    const priority = (a) => {
      const text = (a.message || '').toLowerCase();
      if (text.includes('version is low') || text.includes('update to the latest version')) return 4;
      if (text.includes('s-miles home'))    return 3;
      if (text.includes('argon2'))          return 3;
      if (a.status || a.message)            return 2;
      return 1;
    };
    return failed.reduce((best, a) => priority(a) > priority(best) ? a : best, failed[0]);
  }

  _userFriendlyAuthMessage(attempt) {
    const text = (attempt.message || '').toLowerCase();
    if (text.includes('version is low') || text.includes('update to the latest version')) {
      return 'Hoymiles rejected the app profile/version headers. The account may require a different auth mode or updated app-version metadata.';
    }
    if (text.includes('s-miles home')) {
      return 'This account can only log in to the S-Miles Home app. It may not be compatible with the Web/Installer profile used by this integration.';
    }
    if (text.includes('argon2')) {
      return 'This account requires Argon2id authentication which is not supported in this app runtime. Try using S-Miles Installer credentials instead.';
    }
    if (text.includes('invalid credentials') || text.includes('check your account')) {
      return 'Credentials were rejected by Hoymiles. Verify your email and password.';
    }
    if (attempt.message) {
      return `Hoymiles: ${attempt.message}`;
    }
    return 'Authentication failed — check your S-Miles Cloud email and password.';
  }

  _sanitizedAttempts() {
    return this._lastAuthAttempts.map(a => ({
      mode: a.mode, profile: a.profile, variant: a.variant,
      success: a.success, status: a.status, message: a.message,
    }));
  }

  // ── Headers ────────────────────────────────────────────────────────────────

  _jsonHeaders(profileName, appVersion) {
    const profile = PROFILES[profileName] || PROFILES.web;
    const headers = {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    };

    const version = appVersion || profile.appVersion;
    if (version) {
      headers['User-Agent']    = `${profile.userAgent}/${version}`;
      headers['App-Version']   = version;
      headers['X-App-Version'] = version;
      if (profile.xClientType) {
        headers['X-Client-Type'] = profile.xClientType;
      }
    } else {
      headers['User-Agent'] = profile.userAgent;
    }

    return headers;
  }

  _authHeaders() {
    const headers = this._jsonHeaders(this._activeProfile, this._activeAppVer);
    if (this._token) headers['Authorization'] = this._token;
    return headers;
  }

  // ── Stations ──────────────────────────────────────────────────────────────

  async getStations() {
    const response = await this._request('POST', ENDPOINTS.STATIONS, { page_num: 1, page_size: 100 });
    const list = response?.data?.list;
    if (!Array.isArray(list)) throw new Error('Unexpected response from stations endpoint');
    return list.map(s => ({ id: String(s.id), name: s.name || `Station ${s.id}`, sn: s.sn || '' }));
  }

  // ── Current user ──────────────────────────────────────────────────────────

  async getCurrentUser() {
    return this._request('POST', ENDPOINTS.USER_ME, {});
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

  /**
   * Low-level POST returning parsed JSON. No status checking.
   */
  async _postRaw(url, body, headers) {
    let rawResponse;
    try {
      rawResponse = await fetch(url, {
        method:  'POST',
        headers,
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`Network error: ${err.message}`);
    }

    const text = await rawResponse.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error(`Invalid JSON (HTTP ${rawResponse.status})`);
    }
  }

  /**
   * Authenticated POST with status checking.
   */
  async _request(method, endpoint, body = {}, authenticated = true) {
    const url     = `${this._baseUrl}${endpoint}`;
    const headers = authenticated ? this._authHeaders() : this._jsonHeaders('web');

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

// ─── Custom error class ──────────────────────────────────────────────────────

class HoymilesAuthError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'HoymilesAuthError';
    this.attempts = details.attempts || [];
    this.bestFailure = details.bestFailure || null;
  }
}

module.exports = HoymilesApi;
module.exports.BATTERY_MODES = BATTERY_MODES;
module.exports.HoymilesAuthError = HoymilesAuthError;
module.exports.AUTH_MODE_AUTO = AUTH_MODE_AUTO;
module.exports.AUTH_MODE_WEB_V3 = AUTH_MODE_WEB_V3;
module.exports.AUTH_MODE_INSTALLER_V3 = AUTH_MODE_INSTALLER_V3;
module.exports.AUTH_MODE_LEGACY_V0 = AUTH_MODE_LEGACY_V0;
