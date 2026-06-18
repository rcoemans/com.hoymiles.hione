'use strict';

const { HoymilesApi } = require('./HoymilesApi');
const { ModbusTcpClient } = require('./ModbusTcpClient');
const { ProtobufClient } = require('./ProtobufClient');
const { normalizeRealData } = require('./DataNormalizer');

class PollingService {
  constructor({ log = console.log, error = console.error } = {}) {
    this._log       = log;
    this._error     = error;
    this._plants     = new Map();
    this._listeners  = new Map();
    this._timers     = new Map();
    this._apis       = new Map();
  }

  registerPlant(plantId, config) {
    this._plants.set(plantId, { ...config });
    const api = new HoymilesApi({ log: this._log, error: this._error, baseUrl: config.cloudApiUrl });
    this._apis.set(plantId, api);
    this._log(`PollingService: registered plant ${plantId}`);
  }

  unregisterPlant(plantId) {
    this.stopPolling(plantId);
    this._plants.delete(plantId);
    this._apis.delete(plantId);
    this._listeners.delete(plantId);
    this._log(`PollingService: unregistered plant ${plantId}`);
  }

  addListener(plantId, deviceId, callback) {
    if (!this._listeners.has(plantId)) this._listeners.set(plantId, new Map());
    this._listeners.get(plantId).set(deviceId, callback);
  }

  removeListener(plantId, deviceId) {
    if (this._listeners.has(plantId)) {
      this._listeners.get(plantId).delete(deviceId);
    }
  }

  startPolling(plantId, intervalMs = 60000) {
    this.stopPolling(plantId);
    const clampedMs = Math.max(30000, Math.min(300000, intervalMs));
    this._log(`PollingService: starting poll for plant ${plantId} every ${clampedMs / 1000}s`);

    this._pollPlant(plantId).catch(err => this._error(`Initial poll failed for ${plantId}:`, err.message));

    const timer = setInterval(() => {
      this._pollPlant(plantId).catch(err => this._error(`Poll failed for ${plantId}:`, err.message));
    }, clampedMs);
    this._timers.set(plantId, timer);
  }

  stopPolling(plantId) {
    const timer = this._timers.get(plantId);
    if (timer) {
      clearInterval(timer);
      this._timers.delete(plantId);
      this._log(`PollingService: stopped polling for plant ${plantId}`);
    }
  }

  async pollNow(plantId) {
    return this._pollPlant(plantId);
  }

  async ensureLoggedIn(plantId) {
    const api    = this._apis.get(plantId);
    const config = this._plants.get(plantId);
    if (!api || !config) throw new Error(`Plant ${plantId} not registered`);
    if (!api.isLoggedIn && config.email && config.password) {
      await api.login(config.email, config.password);
    }
    return api;
  }

  getApi(plantId) { return this._apis.get(plantId); }

  async _pollPlant(plantId) {
    const config = this._plants.get(plantId);
    if (!config) return;

    const snapshot = {
      plantId,
      timestamp: new Date().toISOString(),
      cloud:     null,
      local:     null,
      merged:    null,
      source:    'unknown',
      error:     null,
    };

    const mode = config.connectionMode || 'cloud';

    if (mode === 'cloud' || mode === 'hybrid') {
      try {
        const api = await this.ensureLoggedIn(plantId);
        const cloudData = await api.getRealData(config.stationId);
        snapshot.cloud = cloudData;
        snapshot.source = 'cloud';
      } catch (err) {
        this._error(`Cloud poll failed for plant ${plantId}:`, err.message);
        snapshot.error = err.message;
      }
    }

    if ((mode === 'local' || mode === 'hybrid') && config.gatewayIp) {
      try {
        const localData = await this._pollLocal(config);
        snapshot.local = localData;
        if (!snapshot.cloud) snapshot.source = 'local';
        else snapshot.source = 'hybrid';
      } catch (err) {
        this._error(`Local poll failed for plant ${plantId}:`, err.message);
        if (!snapshot.cloud) snapshot.error = err.message;
      }
    }

    snapshot.merged = this._mergeData(snapshot.cloud, snapshot.local);
    this._distribute(plantId, snapshot);
    return snapshot;
  }

  async _pollLocal(config) {
    const protocol = config.localProtocol || 'protobuf';
    if (protocol === 'modbus') {
      const client = new ModbusTcpClient({
        host: config.gatewayIp,
        port: config.localPort || 502,
        unitId: config.modbusUnitId || 1,
        log: this._log,
        error: this._error,
      });
      return client.getData();
    } else {
      const client = new ProtobufClient({
        host: config.gatewayIp,
        port: config.localPort || 10081,
        log: this._log,
        error: this._error,
      });
      const data = await client.getRealData(config.dtuSn || '000000000000');
      return data;
    }
  }

  _mergeData(cloud, local) {
    if (cloud && !local) return normalizeRealData(cloud);
    if (!cloud && local) return local;
    if (!cloud && !local) return null;

    const merged = normalizeRealData(cloud);
    return merged;
  }

  _distribute(plantId, snapshot) {
    const listeners = this._listeners.get(plantId);
    if (!listeners) return;
    for (const [deviceId, callback] of listeners) {
      try {
        callback(snapshot);
      } catch (err) {
        this._error(`Listener error for device ${deviceId}:`, err.message);
      }
    }
  }
}

module.exports = { PollingService };
