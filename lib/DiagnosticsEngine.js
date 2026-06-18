'use strict';

const { ModbusTcpClient } = require('./ModbusTcpClient');
const { ProtobufClient } = require('./ProtobufClient');

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
      exportedAt: new Date().toISOString(),
      snapshotCount: this._snapshots.length,
      config: {
        gatewayIp: this._config?.gatewayIp || null,
        protocol:  this._config?.localProtocol || null,
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

  async _collectSnapshot() {
    if (!this._config) return;

    const snapshot = {
      timestamp: new Date().toISOString(),
      modbus:    null,
      protobuf:  null,
      errors:    [],
    };

    if (this._config.gatewayIp) {
      try {
        const modbusClient = new ModbusTcpClient({
          host:   this._config.gatewayIp,
          port:   this._config.modbusPort || 502,
          unitId: this._config.modbusUnitId || 1,
          log:    this._log,
          error:  this._error,
        });

        const dtuInfo   = await modbusClient.readDtuInfo();
        const essProbe  = await modbusClient.probeEssRegisters();
        const pvPorts   = [];
        for (let i = 0; i < 4; i++) {
          pvPorts.push(await modbusClient.readPvPort(i));
        }

        snapshot.modbus = {
          dtuInfo,
          essProbe,
          pvPorts,
        };
      } catch (err) {
        snapshot.errors.push(`Modbus: ${err.message}`);
      }

      try {
        const protobufClient = new ProtobufClient({
          host: this._config.gatewayIp,
          port: this._config.protobufPort || 10081,
          log:  this._log,
          error: this._error,
        });

        const realData = await protobufClient.getRealData(this._config.dtuSn || '000000000000');
        snapshot.protobuf = realData;
      } catch (err) {
        snapshot.errors.push(`Protobuf: ${err.message}`);
      }
    }

    this._snapshots.push(snapshot);
    this._log(`DiagnosticsEngine: snapshot #${this._snapshots.length} collected`);
  }
}

module.exports = { DiagnosticsEngine };
