'use strict';

const HoymilesLocal    = require('./HoymilesLocal');
const HoymilesApi      = require('./HoymilesApi');
const ModbusTcpClient  = require('./ModbusTcpClient');

const LOCAL_RETRY_AFTER_MS = 5 * 60 * 1000;
const LOCAL_FAIL_THRESHOLD = 3;

class HoymilesHybrid {
  constructor({ gatewayIp, gatewayPort, email, password, stationId, log, error, baseUrl, mode }) {
    this._email     = email;
    this._password  = password;
    this._stationId = stationId;
    this.log        = log;
    this.error      = error;
    this._mode   = mode || 'both'; // 'local' | 'both' | 'cloud'
    // Only create local/modbus clients if mode allows local and IP is provided
    const useLocal = this._mode !== 'cloud' && gatewayIp;
    this._local  = useLocal ? new HoymilesLocal({ host: gatewayIp, port: gatewayPort, log, error }) : null;
    this._modbus = useLocal ? new ModbusTcpClient({ host: gatewayIp, log, error }) : null;
    this._cloud  = new HoymilesApi({ log, error, baseUrl });
    this._localFails       = 0;
    this._localCooldownEnd = 0;
    this._modbusAvailable  = false;   // set true after successful Modbus probe
    this._cloudFallbackEnabled = this._mode !== 'local' && !!(email && password);
    this.connectionMode    = this._mode === 'cloud' ? 'cloud' : (useLocal ? 'unknown' : 'cloud');
    this.log(`[Hybrid] mode=${this._mode}, local=${!!this._local}, cloud=${this._cloudFallbackEnabled}`);
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

    if (!this._cloudFallbackEnabled) {
      throw new Error('Local gateway unreachable and cloud fallback is disabled (mode: ' + this._mode + ')');
    }

    await this._cloud.ensureToken(this._email, this._password);
    const realData = await this._cloud.getRealData(this._stationId);

    // getRealData now includes energy from the same endpoint (kWh)
    let dailyEnergy = realData.dailyEnergy || 0;
    let totalEnergy = realData.totalEnergy || 0;

    // Fallback: separate energy endpoint only if real-data didn't include energy
    if (!dailyEnergy && !totalEnergy) {
      this.log('[Hybrid] No energy in real-data — trying energy endpoint...');
      const energyData = await this._cloud.getEnergyData(this._stationId);
      dailyEnergy = energyData.dailyEnergy;
      totalEnergy = energyData.totalEnergy;
    }

    this.connectionMode = 'cloud';
    return {
      pvPower: realData.pvPower, batteryPower: realData.batteryPower,
      batterySoc: realData.batterySoc, gridPower: realData.gridPower,
      loadPower: realData.loadPower, batteryMode: realData.batteryMode,
      dailyEnergy, totalEnergy,
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

  async getStationInfo() {
    if (!this._email || !this._password || !this._stationId) return null;
    try {
      await this._cloud.ensureToken(this._email, this._password);
      return await this._cloud.getStationInfo(this._stationId);
    } catch (err) {
      this.log('[Hybrid] Cloud station info failed: ' + err.message);
      return null;
    }
  }

  async getDevices() {
    if (!this._email || !this._password || !this._stationId) return null;
    try {
      await this._cloud.ensureToken(this._email, this._password);
      return await this._cloud.getDevices(this._stationId);
    } catch (err) {
      this.log('[Hybrid] Cloud getDevices failed: ' + err.message);
      return null;
    }
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
        const localResult = {
          pvPower:      realData.pvPower,
          batteryPower: storageData ? storageData.batteryPower : realData.batteryPower,
          batterySoc:   storageData ? storageData.batterySoc   : realData.batterySoc,
          gridPower:    realData.gridPower,
          loadPower:    realData.loadPower,
          batteryMode:  storageData ? storageData.batteryMode  : realData.batteryMode,
          dailyEnergy:  storageData ? storageData.dailyEnergy  : 0,
          totalEnergy:  storageData ? storageData.totalEnergy  : 0,
        };

        // Energy top-up: if local has no energy data, try cloud
        if (!localResult.dailyEnergy && !localResult.totalEnergy && this._cloudFallbackEnabled) {
          try {
            await this._cloud.ensureToken(this._email, this._password);
            const energyData = await this._cloud.getEnergyData(this._stationId);
            localResult.dailyEnergy = energyData.dailyEnergy || localResult.dailyEnergy;
            localResult.totalEnergy = energyData.totalEnergy || localResult.totalEnergy;
            this.log('[Hybrid] Energy topped up from cloud: daily=' + localResult.dailyEnergy + ' total=' + localResult.totalEnergy);
          } catch (eErr) {
            this.log('[Hybrid] Energy top-up from cloud failed: ' + eErr.message);
          }
        }

        return localResult;
      } catch (err) {
        this.log('[Hybrid] Protobuf failed: ' + err.message + ' — trying Modbus TCP...');
      }
    }

    // Fallback: Modbus TCP (confirmed DTU-Pro registers only; ESS data not guessed)
    if (this._modbus && this._modbusAvailable) {
      const modbusData = await this._modbus.getData();
      this._logModbusConfidence(modbusData);
      return modbusData;
    }

    // If protobuf client exists but Modbus isn't probed yet, probe now
    if (this._modbus && !this._modbusAvailable) {
      const ok = await this._modbus.isReachable();
      if (ok) {
        this._modbusAvailable = true;
        this.log('[Hybrid] Modbus TCP became available — using it');
        const modbusData = await this._modbus.getData();
        this._logModbusConfidence(modbusData);
        return modbusData;
      }
    }

    throw new Error('All local protocols failed');
  }

  /**
   * Run a Modbus TCP register scan diagnostic (known blocks + ESS candidates).
   * @returns {Promise<object|null>}
   */
  async scanModbusRegisters() {
    if (!this._modbus) return null;
    return this._modbus.scanKnownBlocks();
  }

  /**
   * Run a comprehensive Modbus TCP deep scan (0x0000–0xFFFF).
   * Tests FC03/FC04, decodes ASCII strings, provides multiple value interpretations.
   * @returns {Promise<object|null>}
   */
  async deepScanModbusRegisters() {
    if (!this._modbus) return null;
    return this._modbus.deepScan();
  }

  /**
   * Run experimental ESS register probe with plausibility validation.
   * Results are NOT used for capabilities — for diagnostic/discovery only.
   * @returns {Promise<object|null>}
   */
  async probeModbusEss() {
    if (!this._modbus) return null;
    return this._modbus.probeEssRegisters();
  }

  /**
   * Log confidence summary when using Modbus TCP data.
   * Warns about unconfirmed ESS fields.
   */
  // ── Settings proxy (cloud) ─────────────────────────────────────────────

  async readBatterySettings() {
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.readBatterySettings(this._stationId);
  }

  async writeBatterySettings(settings) {
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.writeBatterySettings(this._stationId, settings);
  }

  async setBatteryModeWithParams(mode, params) {
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.setBatteryModeWithParams(this._stationId, mode, params);
  }

  async setRelay(enabled) {
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.setRelay(this._stationId, enabled);
  }

  async setPowerLimit(limitPct) {
    // Prefer local protocol (EEPROM write protection applies)
    if (this._localAvailable() && this._local) {
      try {
        await this._local.setPowerLimit(limitPct);
        this.log('[Hybrid] setPowerLimit(' + limitPct + '%) via LOCAL');
        return 'local';
      } catch (err) {
        this.log('[Hybrid] Local setPowerLimit failed: ' + err.message);
      }
    }
    // Modbus fallback
    if (this._modbus && this._modbusAvailable) {
      try {
        await this._modbus.setPowerLimit(limitPct);
        this.log('[Hybrid] setPowerLimit(' + limitPct + '%) via MODBUS');
        return 'modbus';
      } catch (err) {
        this.log('[Hybrid] Modbus setPowerLimit failed: ' + err.message);
      }
    }
    throw new Error('No local transport available for power limit control');
  }

  async setInverterState(on) {
    // Prefer local protocol
    if (this._localAvailable() && this._local) {
      try {
        await this._local.setInverterState(on);
        this.log('[Hybrid] setInverterState(' + on + ') via LOCAL');
        return 'local';
      } catch (err) {
        this.log('[Hybrid] Local setInverterState failed: ' + err.message);
      }
    }
    // Modbus fallback
    if (this._modbus && this._modbusAvailable) {
      try {
        await this._modbus.setInverterState(on);
        this.log('[Hybrid] setInverterState(' + on + ') via MODBUS');
        return 'modbus';
      } catch (err) {
        this.log('[Hybrid] Modbus setInverterState failed: ' + err.message);
      }
    }
    throw new Error('No local transport available for inverter state control');
  }

  // ── Cloud data proxies ──────────────────────────────────────────────

  async getEpsProfit() {
    if (!this._cloudFallbackEnabled) return { profitToday: 0, profitTotal: 0, co2Reduction: 0 };
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.getEpsProfit(this._stationId);
  }

  async getMonthlyEnergy() {
    if (!this._cloudFallbackEnabled) return 0;
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.getMonthlyEnergy(this._stationId);
  }

  async getYearlyEnergy() {
    if (!this._cloudFallbackEnabled) return 0;
    await this._cloud.ensureToken(this._email, this._password);
    return this._cloud.getYearlyEnergy(this._stationId);
  }

  _logModbusConfidence(data) {
    if (!data || !data.confidence) return;
    const c = data.confidence;
    const confirmed = Object.entries(c).filter(([, v]) => v === 'confirmed').map(([k]) => k);
    const none = Object.entries(c).filter(([, v]) => v === 'none').map(([k]) => k);
    if (confirmed.length > 0) {
      this.log('[Hybrid] Modbus confirmed: ' + confirmed.join(', '));
    }
    if (none.length > 0) {
      this.log('[Hybrid] Modbus unconfirmed (zeros): ' + none.join(', ') + ' — ESS registers not mapped for this device');
    }
  }
}

module.exports = HoymilesHybrid;
