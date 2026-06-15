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
const { postJson }   = require('./HttpClient');

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

// ─── Login hardening ────────────────────────────────────────────────────────

const BACKOFF_BASE_MS      = 30_000;       // 30 s initial backoff
const BACKOFF_MAX_MS       = 12 * 3600_000; // 12 h max (account-lockout scenario)
const BACKOFF_MULTIPLIER   = 2;
const ACCOUNT_BLOCK_COOLDOWN_MS = 12 * 3600_000; // 12 h after detected account block

// ─── Auth profiles ───────────────────────────────────────────────────────────

const AUTH_MODE_AUTO         = 'auto';
const AUTH_MODE_WEB_V3       = 'web_v3';
const AUTH_MODE_HOME_V3      = 'home_v3';
const AUTH_MODE_INSTALLER_V3 = 'installer_v3';
const AUTH_MODE_LEGACY_V0    = 'legacy_v0';

const EU_BASE_URL = 'https://euapi.hoymiles.com';

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
  home: {
    userAgent:    'sma/ad',
    appVersion:   '2.10.0',
    xClientType:  null,
    uaStyle:      'smiles_app',
    tid:          159,
    dc:           0,
    baseUrl:      EU_BASE_URL,
  },
};

const AUTH_MODE_TO_PROFILE = {
  [AUTH_MODE_WEB_V3]:       'web',
  [AUTH_MODE_HOME_V3]:      'home',
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

    // Login hardening state
    this._consecutiveAuthFails = 0;
    this._authBackoffUntil     = 0;   // timestamp: don't attempt auth before this
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

    // ── Backoff guard ──────────────────────────────────────────────────────
    const now = Date.now();
    if (now < this._authBackoffUntil) {
      const waitSec = Math.ceil((this._authBackoffUntil - now) / 1000);
      const waitMin = Math.round(waitSec / 60);
      const display = waitMin >= 2 ? `${waitMin} min` : `${waitSec} s`;
      throw new HoymilesAuthError(
        `Login temporarily blocked (backoff). Next attempt in ${display}. ` +
        `This protects your S-Miles account from repeated failed logins.`,
        { backoff: true, retryAfter: this._authBackoffUntil }
      );
    }

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
        this._consecutiveAuthFails = 0;
        this._authBackoffUntil     = 0;
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

    // ── Apply backoff ────────────────────────────────────────────────────
    this._consecutiveAuthFails++;
    if (this._isAccountBlocked(best)) {
      // Account locked by Hoymiles — long cooldown
      this._authBackoffUntil = Date.now() + ACCOUNT_BLOCK_COOLDOWN_MS;
      this.log(`[HoymilesApi] Account appears blocked — backing off for 12 hours`);
    } else {
      const delay = Math.min(BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, this._consecutiveAuthFails - 1), BACKOFF_MAX_MS);
      this._authBackoffUntil = Date.now() + delay;
      this.log(`[HoymilesApi] Auth backoff: ${Math.round(delay / 1000)}s (fail #${this._consecutiveAuthFails})`);
    }

    // Build a user-facing message that includes all attempt outcomes
    const attemptLines = this._lastAuthAttempts.map(a =>
      `${a.mode}[${a.profile}]: ${a.message || 'unknown error'}`
    ).join('\n');
    const friendlyMsg = best ? this._userFriendlyAuthMessage(best) : 'All authentication methods failed';

    throw new HoymilesAuthError(
      `${friendlyMsg}\n\nAttempt details:\n${attemptLines}`,
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

    // Step 2: Build credential hash candidates (Argon2id when salted, SHA/MD5 when unsalted)
    let candidates;
    if (salt) {
      this.log(`[HoymilesApi] ${modeName}/${profileName}: Argon2id salt detected, computing hash...`);
      try {
        candidates = await this._buildArgon2idCandidates(salt);
      } catch (err) {
        return this._makeAttempt(modeName, profileName, false, null,
          `Argon2id computation failed: ${err.message}`, appVersion);
      }
    } else {
      candidates = this._buildUnsaltedV3Candidates();
    }
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

    if (mode === AUTH_MODE_HOME_V3) return [{ mode: AUTH_MODE_HOME_V3, profile: 'home' }];

    // auto: web first (most common), then installer, then home (EU gateway), then legacy
    return [
      { mode: AUTH_MODE_WEB_V3,       profile: 'web' },
      { mode: AUTH_MODE_INSTALLER_V3, profile: 'installer' },
      { mode: AUTH_MODE_HOME_V3,      profile: 'home' },
      { mode: AUTH_MODE_LEGACY_V0,    profile: 'web' },
    ];
  }

  async _buildArgon2idCandidates(saltParam) {
    const { argon2id } = require('hash-wasm');

    // Decode salt: try hex first (reference impl observed hex strings), then base64
    const saltStr = String(saltParam).trim();
    let saltBytes;
    try {
      if (saltStr.length % 2 === 0) saltBytes = new Uint8Array(Buffer.from(saltStr, 'hex'));
    } catch (_) { /* not hex */ }
    if (!saltBytes || saltBytes.length === 0) {
      try { saltBytes = new Uint8Array(Buffer.from(saltStr, 'base64')); } catch (_) {}
    }
    if (!saltBytes || saltBytes.length === 0) {
      saltBytes = new Uint8Array(Buffer.from(saltStr, 'utf8'));
    }
    if (saltBytes.length === 0) throw new Error('Empty salt');

    // Reference implementation params: time_cost=3, memory_cost=32768, parallelism=1, hash_len=32
    const t = 3, m = 32768, p = 1, hashLength = 32;
    const password = new Uint8Array(Buffer.from(this._password, 'utf8'));
    this.log(`[HoymilesApi] Argon2id params: m=${m}, t=${t}, p=${p}, saltLen=${saltBytes.length}`);

    const hashHex = await argon2id({
      password,
      salt: saltBytes,
      parallelism: p,
      iterations: t,
      memorySize: m,
      hashLength,
      outputType: 'hex',
    });

    // Reference impl: ch = raw_hash.hex() — single candidate
    return [
      { variant: 'argon2id_hex', ch: hashHex },
    ];
  }

  _buildUnsaltedV3Candidates() {
    const md5hex    = createHash('md5').update(this._password).digest('hex');
    const sha256b64 = createHash('sha256').update(this._password).digest('base64');
    const sha256hex = createHash('sha256').update(this._password).digest('hex');
    return [
      { variant: 'md5_sha256b64', ch: `${md5hex}.${sha256b64}` },
      { variant: 'sha256_hex',    ch: sha256hex },
      { variant: 'sha256_b64',    ch: sha256b64 },
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

  /**
   * Detect if the failure indicates the account has been blocked/locked by Hoymiles.
   */
  _isAccountBlocked(attempt) {
    if (!attempt) return false;
    const text = (attempt.message || '').toLowerCase();
    return text.includes('blocked') || text.includes('locked')
      || text.includes('too many') || text.includes('temporarily')
      || text.includes('account has been') || text.includes('suspend');
  }

  /**
   * Reset auth backoff (e.g. after credentials change).
   */
  resetBackoff() {
    this._consecutiveAuthFails = 0;
    this._authBackoffUntil     = 0;
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

    // S-Miles Home consumer app requires special UA: sma/ad/{version}/{tid}/{dc}
    if (profile.uaStyle === 'smiles_app') {
      const v = version || '2.10.0';
      const tid = profile.tid ?? 159;
      const dc  = profile.dc ?? 0;
      headers['User-Agent'] = `${profile.userAgent}/${v}/${tid}/${dc}`;
      return headers;
    }

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
    // Always use neutral 'web' profile for data requests — the token is
    // profile-independent, but neapi may reject/redirect requests carrying
    // the S-Miles Home or Installer User-Agent strings.
    const headers = this._jsonHeaders('web');
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

  // ── Station info ─────────────────────────────────────────────────────────

  async getStationInfo(stationId) {
    try {
      const response = await this._request('POST', ENDPOINTS.STATIONS, { page_num: 1, page_size: 100 });
      const list = response?.data?.list;
      if (!Array.isArray(list)) return null;
      const station = list.find(s => String(s.id) === String(stationId));
      if (!station) return null;
      this.log('[HoymilesApi] Station info: ' + JSON.stringify(station).substring(0, 500));
      return {
        sn: station.sn || station.dtu_sn || station.serial || '',
        firmwareVersion: station.firmware_version || station.sw_version || station.software_ver || '',
        hardwareVersion: station.hardware_version || station.hw_version || station.device_ver || '',
        name: station.name || '',
      };
    } catch (err) {
      this.log('[HoymilesApi] getStationInfo failed: ' + err.message);
      return null;
    }
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

    // Log raw response structure for diagnostics
    this.log('[HoymilesApi] Real-data keys: ' + Object.keys(d).join(', '));
    this.log('[HoymilesApi] Real-data sample: ' + JSON.stringify(d).substring(0, 800));

    // Some API versions nest data inside a sub-object
    const r = d.reflux_station_data || d.station_data || d.real_data || d;

    // ESS (battery) data may be in a separate sub-object
    const es = d.es_data || d.ess_data || d.storage_data || d.battery_data || r.es_data || r.ess_data || r.storage_data || r;

    // Log sub-object keys for debugging
    if (es !== r) this.log('[HoymilesApi] ESS sub-object keys: ' + Object.keys(es).join(', '));

    // Helper: find first defined value from multiple candidate fields across multiple objects
    const pick = (...sources) => {
      for (const s of sources) {
        if (s !== undefined && s !== null && s !== '') return s;
      }
      return 0;
    };

    const pvPower = this._num(pick(
      r.pv_power, r.real_power, r.pvPower, r.capacitor_power, r.cap_power, r.pv_total_power,
      d.pv_power, d.real_power, d.capacitor_power, d.cap_power, d.pv_total_power
    ));

    const batteryPower = this._num(pick(
      es.battery_power, es.es_power, es.bat_power, es.storage_power, es.batteryPower,
      r.battery_power, r.es_power, r.bat_power, r.storage_power, r.batteryPower,
      d.battery_power, d.es_power, d.bat_power
    ));

    const batterySoc = this._num(pick(
      es.battery_soc, es.es_soc, es.soc, es.bsoc, es.battery_percent, es.batterySoc,
      r.battery_soc, r.es_soc, r.soc, r.bsoc, r.batterySoc,
      d.battery_soc, d.es_soc, d.soc
    ));

    const gridPower = this._num(pick(
      r.grid_power, r.meter_power, r.gridPower, r.reflux_power,
      d.grid_power, d.meter_power, d.reflux_power
    ));

    const loadPower = this._num(pick(
      r.load_power, r.home_load_power, r.loadPower, r.home_power,
      d.load_power, d.home_load_power, d.home_power
    ));

    const batteryMode = String(pick(
      es.work_mode, es.workMode, es.battery_mode, es.mode,
      r.work_mode, r.workMode, r.battery_mode,
      d.work_mode, d.workMode
    ));

    this.log(`[HoymilesApi] Parsed: pv=${pvPower} bat=${batteryPower} soc=${batterySoc} grid=${gridPower} load=${loadPower} mode=${batteryMode}`);

    return { pvPower, batteryPower, batterySoc, gridPower, loadPower, batteryMode };
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
      this.log('[HoymilesApi] Energy-data keys: ' + (d ? Object.keys(d).join(', ') : 'null'));
      this.log('[HoymilesApi] Energy-data sample: ' + JSON.stringify(d).substring(0, 600));

      // Energy data may be nested in sub-objects
      const e = d?.energy_data || d?.station_energy || d?.eq_data || d;

      const dailyEnergy = this._num(
        e?.today_eq ?? e?.co_energy ?? e?.dailyEnergy ?? e?.day_eq ?? e?.daily_energy ?? e?.today_energy ??
        d?.today_eq ?? d?.co_energy ?? d?.dailyEnergy ?? d?.day_eq ?? d?.daily_energy ?? 0
      );

      const totalEnergy = this._num(
        e?.total_eq ?? e?.totalEnergy ?? e?.all_eq ?? e?.cumulative_eq ?? e?.total_energy ?? e?.lifetime_energy ??
        d?.total_eq ?? d?.totalEnergy ?? d?.all_eq ?? d?.cumulative_eq ?? d?.total_energy ?? 0
      );

      this.log(`[HoymilesApi] Parsed energy: daily=${dailyEnergy} total=${totalEnergy}`);
      return { dailyEnergy, totalEnergy };
    } catch (err) {
      this.log('[HoymilesApi] Energy-data failed: ' + (err.message || err));
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
  async _postRaw(url, body, headers, timeoutMs = 10_000) {
    try {
      const res = await postJson(url, body, headers, timeoutMs);
      if (!res.data) throw new Error(`Invalid JSON (HTTP ${res.status})`);
      return res.data;
    } catch (err) {
      throw new Error(`Network error: ${err.message}`);
    }
  }

  /**
   * Authenticated POST with status checking.
   * Re-authenticates once on HTTP 401/403 or API-level token errors.
   */
  async _request(method, endpoint, body = {}, authenticated = true) {
    const url = `${this._baseUrl}${endpoint}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = authenticated ? this._authHeaders() : this._jsonHeaders('web');
      this.log(`[HoymilesApi] ${method} ${endpoint}${attempt > 0 ? ' (retry after re-auth)' : ''}`);

      let res;
      try {
        res = await postJson(url, body, headers, 15_000);
      } catch (err) {
        throw new Error(`Network error on ${endpoint}: ${err.message}`);
      }

      if (!res.ok) {
        const snippet = String(res.data?.message || res.rawBody || '').substring(0, 200);
        this.log(`[HoymilesApi] HTTP ${res.status} on ${endpoint}: ${snippet}`);
        if (authenticated && attempt === 0 && (res.status === 401 || res.status === 403) && this._username && this._password) {
          this.log(`[HoymilesApi] Re-authenticating after HTTP ${res.status}...`);
          this._token = null; this._tokenExpiry = 0;
          try { await this.authenticate(this._username, this._password); } catch (_) {}
          if (this._token) continue;
        }
        throw new Error(`HTTP ${res.status} on ${endpoint}`);
      }

      const json = res.data;
      if (!json) {
        this.log(`[HoymilesApi] Non-JSON response on ${endpoint}: ${String(res.rawBody || '').substring(0, 200)}`);
        throw new Error(`Invalid JSON from ${endpoint}`);
      }

      if (String(json.status ?? '0') !== '0') {
        const msg = json.message ?? `status ${json.status}`;
        this.log(`[HoymilesApi] API error on ${endpoint}: status=${json.status} message=${msg}`);
        if (authenticated && attempt === 0 && this._isTokenError(json.status, json.message) && this._username && this._password) {
          this.log(`[HoymilesApi] Re-authenticating after API error...`);
          this._token = null; this._tokenExpiry = 0;
          try { await this.authenticate(this._username, this._password); } catch (_) {}
          if (this._token) continue;
        }
        throw new Error(`API error on ${endpoint}: ${msg}`);
      }

      return json;
    }
  }

  _isTokenError(status, message) {
    const s = String(status || '');
    const m = (message || '').toLowerCase();
    return s === '401' || s === '403' || s === '100'
      || m.includes('token') || m.includes('unauthorized') || m.includes('expired')
      || m.includes('not logged in') || m.includes('authentication');
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
module.exports.AUTH_MODE_HOME_V3 = AUTH_MODE_HOME_V3;
module.exports.AUTH_MODE_INSTALLER_V3 = AUTH_MODE_INSTALLER_V3;
module.exports.AUTH_MODE_LEGACY_V0 = AUTH_MODE_LEGACY_V0;
