'use strict';

const HoymilesLocal    = require('./HoymilesLocal');
const HoymilesApi      = require('./HoymilesApi');
const ModbusTcpClient  = require('./ModbusTcpClient');

const LOCAL_RETRY_AFTER_MS = 5 * 60 * 1000;
const LOCAL_FAIL_THRESHOLD = 3;

class HoymilesHybrid {
  constructor({ gatewayIp, gatewayPort, email, password, stationId, log, error, baseUrl }) {
    this._email     = email;
    this._password  = password;
    this._stationId = stationId;
    this.log        = log;
    this.error      = error;
    this._local  = gatewayIp ? new HoymilesLocal({ host: gatewayIp, port: gatewayPort, log, error }) : null;
    this._modbus = gatewayIp ? new ModbusTcpClient({ host: gatewayIp, log, error }) : null;
    this._cloud  = new HoymilesApi({ log, error, baseUrl });
    this._localFails       = 0;
    this._localCooldownEnd = 0;
    this._modbusAvailable  = false;   // set true after successful Modbus probe
    this._cloudFallbackEnabled = !!(email && password);
    this.connectionMode    = gatewayIp ? 'unknown' : 'cloud';
  }

  async getData() {
    if (this._localAvailable()) {
      try {
        const data = await this._getLocalData();
        this._localFails    = 0;
        this.connectionMode = 'local';
        return { ...data, source: 'local' };
      } catch (err) {
        this._localFails++;
        this.log('[Hybrid] Local failed (' + this._localFails + '/' + LOCAL_FAIL_THRESHOLD + '): ' + err.message);
        if (this._localFails >= LOCAL_FAIL_THRESHOLD) {
          this._localCooldownEnd = Date.now() + LOCAL_RETRY_AFTER_MS;
        }
      }
    }

    if (!this._cloudFallbackEnabled && this._local) {
      throw new Error('Local gateway unreachable and cloud fallback is disabled');
    }

    await this._cloud.ensureToken(this._email, this._password);
    const realData   = await this._cloud.getRealData(this._stationId);
    const energyData = await this._cloud.getEnergyData(this._stationId);
    this.connectionMode = 'cloud';
    return {
      pvPower: realData.pvPower, batteryPower: realData.batteryPower,
      batterySoc: realData.batterySoc, gridPower: realData.gridPower,
      loadPower: realData.loadPower, batteryMode: realData.batteryMode,
      dailyEnergy: energyData.dailyEnergy, totalEnergy: energyData.totalEnergy,
      source: 'cloud',
    };
  }

  async setBatteryMode(mode) {
    const modeNum = Number(mode);
    if (this._localAvailable()) {
      try {
        await this._local.setBatteryMode(modeNum);
        this.log('[Hybrid] setBatteryMode(' + modeNum + ') via LOCAL');
        return 'local';
      } catch (err) {
        this.log('[Hybrid] Local setBatteryMode failed: ' + err.message + ' - using cloud');
      }
    }
    await this._cloud.ensureToken(this._email, this._password);
    await this._cloud.setBatteryMode(this._stationId, modeNum);
    this.log('[Hybrid] setBatteryMode(' + modeNum + ') via CLOUD');
    return 'cloud';
  }

  async getGatewayInfo() {
    if (!this._local) return null;
    return this._local.getGatewayInfo();
  }

  async probeLocal() {
    if (!this._local && !this._modbus) return false;

    // Try proprietary protocol first
    if (this._local) {
      const ok = await this._local.isReachable();
      if (ok) {
        this.log('[Hybrid] Local gateway (protobuf): REACHABLE');
        this._localFails = 0; this._localCooldownEnd = 0;
        return true;
      }
    }

    // Try Modbus TCP fallback
    if (this._modbus) {
      const modbusOk = await this._modbus.isReachable();
      this._modbusAvailable = modbusOk;
      if (modbusOk) {
        this.log('[Hybrid] Local gateway (Modbus TCP): REACHABLE');
        this._localFails = 0; this._localCooldownEnd = 0;
        return true;
      }
    }

    this.log('[Hybrid] Local gateway: UNREACHABLE (both protobuf and Modbus) - using cloud');
    return false;
  }

  setCloudFallback(enabled) {
    this._cloudFallbackEnabled = enabled;
    this.log('[Hybrid] Cloud fallback ' + (enabled ? 'ENABLED' : 'DISABLED'));
  }

  forceLocal() {
    this._localFails = 0;
    this._localCooldownEnd = 0;
    this.log('[Hybrid] Forced local reconnect attempt');
  }

  forceCloud() {
    if (this._local) {
      this._localCooldownEnd = Date.now() + LOCAL_RETRY_AFTER_MS;
      this.log('[Hybrid] Forced cloud connection for ' + (LOCAL_RETRY_AFTER_MS / 1000) + 's');
    }
  }

  _localAvailable() {
    return (this._local !== null || this._modbusAvailable) && Date.now() >= this._localCooldownEnd;
  }

  async _getLocalData() {
    // Try proprietary protobuf protocol first
    if (this._local) {
      try {
        const [realData, storageData] = await Promise.all([
          this._local.getRealData(),
          this._local.getEnergyStorageData(),
        ]);
        return {
          pvPower:      realData.pvPower,
          batteryPower: storageData ? storageData.batteryPower : realData.batteryPower,
          batterySoc:   storageData ? storageData.batterySoc   : realData.batterySoc,
          gridPower:    realData.gridPower,
          loadPower:    realData.loadPower,
          batteryMode:  storageData ? storageData.batteryMode  : realData.batteryMode,
          dailyEnergy:  storageData ? storageData.dailyEnergy  : 0,
          totalEnergy:  storageData ? storageData.totalEnergy  : 0,
        };
      } catch (err) {
        this.log('[Hybrid] Protobuf failed: ' + err.message + ' — trying Modbus TCP...');
      }
    }

    // Fallback: Modbus TCP
    if (this._modbus && this._modbusAvailable) {
      return await this._modbus.getData();
    }

    // If protobuf client exists but Modbus isn't probed yet, probe now
    if (this._modbus && !this._modbusAvailable) {
      const ok = await this._modbus.isReachable();
      if (ok) {
        this._modbusAvailable = true;
        this.log('[Hybrid] Modbus TCP became available — using it');
        return await this._modbus.getData();
      }
    }

    throw new Error('All local protocols failed');
  }

  /**
   * Run a Modbus TCP register scan diagnostic.
   * @returns {Promise<object|null>}
   */
  async scanModbusRegisters() {
    if (!this._modbus) return null;
    return this._modbus.scanKnownBlocks();
  }
}

module.exports = HoymilesHybrid;
