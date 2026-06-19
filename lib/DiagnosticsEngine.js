'use strict';

const { ModbusTcpClient } = require('./ModbusTcpClient');
const { ProtobufClient } = require('./ProtobufClient');

// Fields to correlate between Cloud API, Modbus and Protobuf
const FIELD_MAP = [
  { name: 'pvPower',            cloudKeys: ['pv_power','real_power','capacitor_power'],          modbusPath: 'plant.pvPower',     protobufPath: 'pvPower',     unit: 'W' },
  { name: 'batteryPower',       cloudKeys: ['bms_power','battery_power','bat_power'],             modbusPath: 'plant.batteryPower', protobufPath: 'batteryPower', unit: 'W' },
  { name: 'batterySoc',         cloudKeys: ['bms_soc','battery_soc','soc'],                       modbusPath: 'ess.soc',           protobufPath: 'batterySoc',  unit: '%' },
  { name: 'gridPower',          cloudKeys: ['grid_power','meter_power'],                          modbusPath: 'plant.gridPower',   protobufPath: 'gridPower',   unit: 'W' },
  { name: 'loadPower',          cloudKeys: ['load_power','home_power'],                           modbusPath: 'plant.loadPower',   protobufPath: 'loadPower',   unit: 'W' },
  { name: 'dailyEnergy',        cloudKeys: ['today_eq','daily_energy','today_energy'],            modbusPath: 'plant.dailyEnergy', protobufPath: 'dailyEnergy', unit: 'kWh' },
  { name: 'totalEnergy',        cloudKeys: ['total_eq','total_energy','lifetime_energy'],         modbusPath: 'plant.totalEnergy', protobufPath: 'totalEnergy', unit: 'kWh' },
  { name: 'batteryVoltage',     cloudKeys: ['battery_voltage','bat_voltage'],                     modbusPath: 'ess.voltage',       protobufPath: 'batteryVoltage', unit: 'V' },
  { name: 'batteryCurrent',     cloudKeys: ['battery_current','bat_current'],                     modbusPath: 'ess.current',       protobufPath: 'batteryCurrent', unit: 'A' },
  { name: 'batteryChargeEnergy', cloudKeys: ['charge_today','charge_energy'],                    modbusPath: null,                protobufPath: null,          unit: 'kWh' },
  { name: 'batteryDischargeEnergy', cloudKeys: ['discharge_today','discharge_energy'],           modbusPath: null,                protobufPath: null,          unit: 'kWh' },
  { name: 'co2Reduction',       cloudKeys: ['co2_emission_reduction','co2_reduction'],            modbusPath: null,                protobufPath: null,          unit: 'kg' },
  { name: 'profitToday',        cloudKeys: ['today_income','profit_today'],                       modbusPath: null,                protobufPath: null,          unit: '€' },
  { name: 'touMode',            cloudKeys: ['tou_mode','work_mode','working_mode'],               modbusPath: 'ess.mode',          protobufPath: 'touMode',     unit: '' },
];

function _getNestedPath(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

class DiagnosticsEngine {
  constructor({ log = console.log, error = console.error } = {}) {
    this._log        = log;
    this._error      = error;
    this._running    = false;
    this._snapshots  = [];
    this._timer      = null;
    this._config     = null;
  }

  get isRunning() { return this._running; }
  get snapshotCount() { return this._snapshots.length; }

  start(config, intervalMs = 60000) {
    if (this._running) return;
    this._config  = config;
    this._running = true;
    this._log('DiagnosticsEngine: started');

    this._collectSnapshot().catch(err => this._error('DiagnosticsEngine snapshot error:', err.message));

    this._timer = setInterval(() => {
      this._collectSnapshot().catch(err => this._error('DiagnosticsEngine snapshot error:', err.message));
    }, intervalMs);
  }

  stop() {
    this._running = false;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._log('DiagnosticsEngine: stopped');
  }

  clear() {
    this._snapshots = [];
    this._log('DiagnosticsEngine: cleared');
  }

  export() {
    return {
      exportedAt:    new Date().toISOString(),
      snapshotCount: this._snapshots.length,
      config: {
        gatewayIp:    this._config?.gatewayIp   || null,
        modbusPort:   this._config?.modbusPort   || 502,
        protobufPort: this._config?.protobufPort || 10081,
        modbusUnitId: this._config?.modbusUnitId || 1,
        dtuSn:        this._config?.dtuSn        || null,
      },
      snapshots: this._snapshots,
    };
  }

  getStatus() {
    return {
      running:       this._running,
      snapshotCount: this._snapshots.length,
      lastSnapshot:  this._snapshots.length > 0
        ? this._snapshots[this._snapshots.length - 1].timestamp
        : null,
    };
  }

  // Generates a correlation report across collected snapshots
  generateReport() {
    const snapshots = this._snapshots;
    if (snapshots.length === 0) {
      return { fields: [], snapshotCount: 0, generatedAt: new Date().toISOString() };
    }

    const fields = FIELD_MAP.map(field => {
      const cloudValues    = [];
      const modbusValues   = [];
      const protobufValues = [];

      for (const snap of snapshots) {
        // Cloud value: check raw cloud response for any of the cloud keys
        const cloudRaw = snap.cloud?.raw || snap.cloud;
        if (cloudRaw) {
          for (const key of field.cloudKeys) {
            const v = cloudRaw[key];
            if (v != null && !isNaN(Number(v))) { cloudValues.push(Number(v)); break; }
          }
        }

        // Modbus value
        if (snap.modbus && field.modbusPath) {
          const v = _getNestedPath(snap.modbus, field.modbusPath);
          if (v != null && !isNaN(Number(v))) modbusValues.push(Number(v));
        }

        // Protobuf value
        if (snap.protobuf && field.protobufPath) {
          const v = _getNestedPath(snap.protobuf, field.protobufPath);
          if (v != null && !isNaN(Number(v))) protobufValues.push(Number(v));
        }
      }

      const latestCloud    = cloudValues.length    > 0 ? cloudValues[cloudValues.length - 1]       : null;
      const latestModbus   = modbusValues.length   > 0 ? modbusValues[modbusValues.length - 1]     : null;
      const latestProtobuf = protobufValues.length > 0 ? protobufValues[protobufValues.length - 1] : null;

      // Delta between cloud and best local value
      const localVal = latestProtobuf ?? latestModbus;
      const delta = (latestCloud != null && localVal != null)
        ? Math.abs(latestCloud - localVal)
        : null;

      // Confidence: based on how often values are non-null and how close they are
      let confidence = 0;
      const hasCloud    = cloudValues.length    > 0;
      const hasModbus   = modbusValues.length   > 0;
      const hasProtobuf = protobufValues.length > 0;

      if (hasCloud && (hasModbus || hasProtobuf)) {
        // Coverage score: % of snapshots that have both cloud and local
        const pairedCount = snapshots.reduce((n, snap) => {
          const hasC = (snap.cloud?.raw || snap.cloud) ? 1 : 0;
          const hasL = (snap.modbus || snap.protobuf) ? 1 : 0;
          return n + (hasC && hasL ? 1 : 0);
        }, 0);
        const coverage = pairedCount / snapshots.length;

        // Correlation: how close are the values (within 10% tolerance)
        let matchCount = 0;
        const pairs = Math.min(cloudValues.length, (hasProtobuf ? protobufValues : modbusValues).length);
        const localArr = hasProtobuf ? protobufValues : modbusValues;
        for (let i = 0; i < pairs; i++) {
          const c = cloudValues[i];
          const l = localArr[i];
          const maxVal = Math.max(Math.abs(c), Math.abs(l), 1);
          if (Math.abs(c - l) / maxVal < 0.1) matchCount++;
        }
        const correlation = pairs > 0 ? matchCount / pairs : 0;

        confidence = Math.round((coverage * 0.4 + correlation * 0.6) * 100);
      } else if (hasCloud) {
        confidence = 20; // Cloud only, no local to correlate
      } else if (hasModbus || hasProtobuf) {
        confidence = 10; // Local only, no cloud to compare
      }

      return {
        field:          field.name,
        unit:           field.unit,
        cloudKeys:      field.cloudKeys.join(', '),
        modbusRegister: field.modbusPath || '—',
        protobufField:  field.protobufPath || '—',
        snapshotsWithCloud:    cloudValues.length,
        snapshotsWithModbus:   modbusValues.length,
        snapshotsWithProtobuf: protobufValues.length,
        latestCloud,
        latestModbus,
        latestProtobuf,
        delta,
        confidence,
      };
    });

    return {
      fields,
      snapshotCount: snapshots.length,
      generatedAt:   new Date().toISOString(),
    };
  }

  async _collectSnapshot() {
    if (!this._config || !this._config.gatewayIp) return;

    const snapshot = {
      timestamp:    new Date().toISOString(),
      modbusPort:   this._config.modbusPort   || 502,
      protobufPort: this._config.protobufPort || 10081,
      modbus:       null,
      protobuf:     null,
      errors:       [],
    };

    try {
      const modbusClient = new ModbusTcpClient({
        host:           this._config.gatewayIp,
        port:           this._config.modbusPort   || 502,
        unitId:         this._config.modbusUnitId || 1,
        connectTimeout: 5000,
        log:            this._log,
        error:          this._error,
      });

      const dtuInfo   = await modbusClient.readDtuInfo();
      const essProbe  = await modbusClient.probeEssRegisters();
      const pvPorts   = [];
      for (let i = 0; i < 4; i++) {
        pvPorts.push(await modbusClient.readPvPort(i));
      }

      snapshot.modbus = { dtuInfo, essProbe, pvPorts };
    } catch (err) {
      snapshot.errors.push(`Modbus: ${err.message}`);
    }

    try {
      const protobufClient = new ProtobufClient({
        host:  this._config.gatewayIp,
        port:  this._config.protobufPort || 10081,
        log:   this._log,
        error: this._error,
      });

      const realData = await protobufClient.getRealData(this._config.dtuSn || '000000000000');
      snapshot.protobuf = realData;
    } catch (err) {
      snapshot.errors.push(`Protobuf: ${err.message}`);
    }

    this._snapshots.push(snapshot);
    this._log(`DiagnosticsEngine: snapshot #${this._snapshots.length} collected`);
  }
}

module.exports = { DiagnosticsEngine };
