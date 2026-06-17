'use strict';

import Homey from 'homey';

const HoymilesApi      = require('./lib/HoymilesApi');
const ModbusTcpClient  = require('./lib/ModbusTcpClient');
const ModbusValidator  = require('./lib/ModbusValidator');

const LOG_MAX = 200;

module.exports = class HoymilesHiOneApp extends Homey.App {

  async onInit() {
    this.log('Hoymiles HiOne app started');

    // ── App-level log ring buffer (safe: no class fields, no log interception) ──
    const logBuf: string[] = this.homey.settings.get('app_log') || [];
    const self = this;

    (this as any).appendLog = function (level: string, ...args: any[]) {
      try {
        const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
        const msg = `[${ts}] [${level}] ${args.map((a: any) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}`;
        logBuf.push(msg);
        if (logBuf.length > LOG_MAX) logBuf.splice(0, logBuf.length - LOG_MAX);
        self.homey.settings.set('app_log', logBuf);
      } catch (_) { /* never crash the app for logging */ }
    };

    (this as any).clearLog = function () {
      logBuf.length = 0;
      self.homey.settings.set('app_log', []);
    };

    // Shared API instance; drivers can access via this.homey.app.api
    (this as any).api = new HoymilesApi({
      log:   (...args: any[]) => { this.log(...args); (this as any).appendLog('INFO', ...args); },
      error: (...args: any[]) => { this.error(...args); (this as any).appendLog('ERROR', ...args); },
    });

    // ── Action cards ──────────────────────────────────────────────────────

    this.homey.flow
      .getActionCard('set_battery_mode')
      .registerRunListener(async ({ device, mode }: any) => {
        return device.setBatteryMode(mode);
      });

    this.homey.flow
      .getActionCard('refresh_data')
      .registerRunListener(async ({ device }: any) => {
        return device.pollNow();
      });

    this.homey.flow
      .getActionCard('prefer_local_connection')
      .registerRunListener(async ({ device }: any) => {
        return device.preferLocal();
      });

    this.homey.flow
      .getActionCard('prefer_cloud_connection')
      .registerRunListener(async ({ device }: any) => {
        return device.preferCloud();
      });

    this.homey.flow
      .getActionCard('enable_cloud_fallback')
      .registerRunListener(async ({ device }: any) => {
        return device.setCloudFallback(true);
      });

    this.homey.flow
      .getActionCard('disable_cloud_fallback')
      .registerRunListener(async ({ device }: any) => {
        return device.setCloudFallback(false);
      });

    this.homey.flow
      .getActionCard('set_reserve_soc')
      .registerRunListener(async ({ device, soc }: any) => {
        return device.setReserveSoc(Number(soc));
      });

    this.homey.flow
      .getActionCard('set_max_soc')
      .registerRunListener(async ({ device, soc }: any) => {
        return device.setMaxSoc(Number(soc));
      });

    this.homey.flow
      .getActionCard('set_max_power')
      .registerRunListener(async ({ device, power }: any) => {
        return device.setMaxPower(Number(power));
      });

    this.homey.flow
      .getActionCard('set_grid_limit')
      .registerRunListener(async ({ device, limit }: any) => {
        return device.setGridLimit(Number(limit));
      });

    this.homey.flow
      .getActionCard('set_peak_shaving')
      .registerRunListener(async ({ device, reserve_soc, max_soc, grid_limit }: any) => {
        return device.setPeakShaving(Number(reserve_soc), Number(max_soc), Number(grid_limit));
      });

    this.homey.flow
      .getActionCard('set_tou_period')
      .registerRunListener(async ({ device, charge_from, charge_to, charge_power }: any) => {
        return device.setTouPeriod(charge_from, charge_to, Number(charge_power));
      });

    this.homey.flow
      .getActionCard('set_power_limit')
      .registerRunListener(async ({ device, limit }: any) => {
        return device.setPowerLimit(Number(limit));
      });

    this.homey.flow
      .getActionCard('set_inverter_state')
      .registerRunListener(async ({ device, state }: any) => {
        return device.setInverterState(state === 'on');
      });

    this.homey.flow
      .getActionCard('set_relay')
      .registerRunListener(async ({ device, state }: any) => {
        return device.setRelay(state === 'on');
      });

    // ── Condition cards ───────────────────────────────────────────────────

    this.homey.flow
      .getConditionCard('battery_charging')
      .registerRunListener(async ({ device }: any) => {
        const bp = device.getCapabilityValue('hione_battery_power') ?? 0;
        return bp > 10;
      });

    this.homey.flow
      .getConditionCard('battery_discharging')
      .registerRunListener(async ({ device }: any) => {
        const bp = device.getCapabilityValue('hione_battery_power') ?? 0;
        return bp < -10;
      });

    this.homey.flow
      .getConditionCard('battery_soc_above')
      .registerRunListener(async ({ device, threshold }: any) => {
        const soc = device.getCapabilityValue('measure_battery') ?? 0;
        return soc > threshold;
      });

    this.homey.flow
      .getConditionCard('battery_soc_below')
      .registerRunListener(async ({ device, threshold }: any) => {
        const soc = device.getCapabilityValue('measure_battery') ?? 0;
        return soc < threshold;
      });

    this.homey.flow
      .getConditionCard('grid_importing')
      .registerRunListener(async ({ device }: any) => {
        const gp = device.getCapabilityValue('hione_grid_power') ?? 0;
        return gp > 10;
      });

    this.homey.flow
      .getConditionCard('grid_exporting')
      .registerRunListener(async ({ device }: any) => {
        const gp = device.getCapabilityValue('hione_grid_power') ?? 0;
        return gp < -10;
      });

    this.homey.flow
      .getConditionCard('pv_power_above')
      .registerRunListener(async ({ device, threshold }: any) => {
        const pv = device.getCapabilityValue('hione_pv_power') ?? 0;
        return pv > threshold;
      });

    this.homey.flow
      .getConditionCard('load_power_above')
      .registerRunListener(async ({ device, threshold }: any) => {
        const lp = device.getCapabilityValue('hione_load_power') ?? 0;
        return lp > threshold;
      });

    this.homey.flow
      .getConditionCard('battery_mode_is')
      .registerRunListener(async ({ device, mode }: any) => {
        return device.getCapabilityValue('hione_battery_mode') === String(mode);
      });

    this.homey.flow
      .getConditionCard('gateway_online')
      .registerRunListener(async ({ device }: any) => {
        return device.getCapabilityValue('hione_gateway_online') === true;
      });

    this.homey.flow
      .getConditionCard('connection_is_local')
      .registerRunListener(async ({ device }: any) => {
        return device.getCapabilityValue('hione_connection_source') === 'local';
      });

    // ── Trigger cards with thresholds ─────────────────────────────────────

    this.homey.flow
      .getDeviceTriggerCard('battery_soc_below_threshold')
      .registerRunListener(async ({ device, threshold }: any) => {
        const soc = device.getCapabilityValue('measure_battery') ?? 0;
        return soc < threshold;
      });

    this.homey.flow
      .getDeviceTriggerCard('battery_soc_above_threshold')
      .registerRunListener(async ({ device, threshold }: any) => {
        const soc = device.getCapabilityValue('measure_battery') ?? 0;
        return soc > threshold;
      });

    // ── Modbus validation engine ──────────────────────────────────────────
    (this as any)._validator = null;
    (this as any)._validationInterval = null;

    // ── Settings API: Modbus register scan diagnostic ───────────────────
    this.homey.settings.on('set', (key: string) => {
      if (key === 'run_modbus_scan') {
        this._runModbusScan().catch(() => {});
      }
      if (key === 'run_modbus_deep_scan') {
        this._runModbusDeepScan().catch(() => {});
      }
      if (key === 'run_modbus_ess_probe') {
        this._runModbusEssProbe().catch(() => {});
      }
      if (key === 'start_modbus_validation') {
        this._startModbusValidation().catch(() => {});
      }
      if (key === 'stop_modbus_validation') {
        this._stopModbusValidation();
      }
      if (key === 'export_validation_data') {
        this._exportValidationData();
      }
      if (key === 'clear_validation_data') {
        this._clearValidationData();
      }
    });
  }

  private _createModbusClient(): any {
    const gatewayIp = this.homey.settings.get('gateway_ip');
    if (!gatewayIp) return null;
    return new ModbusTcpClient({
      host: gatewayIp,
      log:   (...args: any[]) => { this.log(...args); (this as any).appendLog?.('INFO', ...args); },
      error: (...args: any[]) => { this.error(...args); (this as any).appendLog?.('ERROR', ...args); },
    });
  }

  private async _runModbusScan() {
    try {
      (this as any).appendLog?.('INFO', 'Modbus register scan requested...');
      const client = this._createModbusClient();
      if (!client) {
        this.homey.settings.set('modbus_scan_result', { error: 'No gateway IP configured in app settings. Set the Gateway IP address first.' });
        return;
      }

      const gatewayIp = this.homey.settings.get('gateway_ip');
      (this as any).appendLog?.('INFO', `Scanning Modbus registers at ${gatewayIp}:502 (known blocks + ESS candidates)...`);
      const result = await client.scanKnownBlocks();

      if (result && Object.keys(result).length > 0) {
        this.homey.settings.set('modbus_scan_result', result);
        (this as any).appendLog?.('INFO', 'Modbus scan completed: ' + JSON.stringify(result).substring(0, 500));
      } else {
        this.homey.settings.set('modbus_scan_result', { error: 'No data returned from Modbus scan. The gateway at ' + gatewayIp + ' may not support Modbus TCP on port 502.' });
        (this as any).appendLog?.('INFO', 'Modbus scan completed but no data returned');
      }
    } catch (err: any) {
      this.homey.settings.set('modbus_scan_result', { error: 'Scan failed: ' + err.message });
      (this as any).appendLog?.('ERROR', 'Modbus scan failed: ' + err.message);
    }
  }

  private async _runModbusDeepScan() {
    try {
      (this as any).appendLog?.('INFO', 'Modbus DEEP scan requested (0x0000–0xFFFF) — this may take a while...');
      const client = this._createModbusClient();
      if (!client) {
        this.homey.settings.set('modbus_deep_scan_result', { error: 'No gateway IP configured in app settings.' });
        return;
      }

      const result = await client.deepScan();
      this.homey.settings.set('modbus_deep_scan_result', result);
      (this as any).appendLog?.('INFO', `Deep scan complete: ${result.summary.totalNonZero} non-zero registers in ${result.summary.totalReadable} readable`);
    } catch (err: any) {
      this.homey.settings.set('modbus_deep_scan_result', { error: 'Deep scan failed: ' + err.message });
      (this as any).appendLog?.('ERROR', 'Modbus deep scan failed: ' + err.message);
    }
  }

  // ── Modbus Validation Engine ──────────────────────────────────────────────

  private async _startModbusValidation() {
    try {
      const intervalSec = this.homey.settings.get('validation_interval') || 60;
      (this as any).appendLog?.('INFO', `Modbus validation starting (interval: ${intervalSec}s)...`);

      // Create validator if needed
      if (!(this as any)._validator) {
        (this as any)._validator = new ModbusValidator({
          log: (...args: any[]) => { this.log(...args); (this as any).appendLog?.('INFO', ...args); },
          error: (...args: any[]) => { this.error(...args); (this as any).appendLog?.('ERROR', ...args); },
        });

        // Restore previous state
        const savedSnapshots = this.homey.settings.get('validation_snapshots');
        const savedConfidence = this.homey.settings.get('validation_confidence');
        if (savedSnapshots || savedConfidence) {
          (this as any)._validator.loadState(savedSnapshots, savedConfidence);
        }
      }

      // Find the first HiOne device for its hybrid instance
      const driver = this.homey.drivers.getDriver('hione');
      const devices = driver.getDevices();
      if (!devices || devices.length === 0) {
        this.homey.settings.set('validation_status', { running: false, error: 'No HiOne device found. Add a device first.' });
        (this as any).appendLog?.('ERROR', 'Validation: No HiOne device found');
        return;
      }

      const device = devices[0] as any;
      const hybrid = device._hybrid;
      if (!hybrid) {
        this.homey.settings.set('validation_status', { running: false, error: 'Device hybrid not initialized' });
        return;
      }

      // Stop existing interval
      if ((this as any)._validationInterval) {
        clearInterval((this as any)._validationInterval);
      }

      // Run first snapshot immediately
      await this._runValidationCycle(hybrid);

      // Start periodic collection
      (this as any)._validationInterval = setInterval(async () => {
        await this._runValidationCycle(hybrid);
      }, intervalSec * 1000);

      this.homey.settings.set('validation_status', {
        running: true,
        startedAt: new Date().toISOString(),
        intervalSec,
        snapshotCount: (this as any)._validator.getSnapshots().length,
      });
      (this as any).appendLog?.('INFO', 'Modbus validation started');
    } catch (err: any) {
      this.homey.settings.set('validation_status', { running: false, error: err.message });
      (this as any).appendLog?.('ERROR', 'Validation start failed: ' + err.message);
    }
  }

  private async _runValidationCycle(hybrid: any) {
    try {
      const validator = (this as any)._validator;
      if (!validator) return;

      const snapshot = await hybrid.collectValidationSnapshot(validator);
      if (!snapshot) return;

      // Save state periodically (every 10 snapshots to reduce settings writes)
      const count = validator.getSnapshots().length;
      if (count % 10 === 0 || count <= 3) {
        this.homey.settings.set('validation_snapshots', validator.getSnapshots());
        this.homey.settings.set('validation_confidence', validator.getConfidence());
      }

      // Update status
      this.homey.settings.set('validation_status', {
        running: true,
        startedAt: this.homey.settings.get('validation_status')?.startedAt,
        intervalSec: this.homey.settings.get('validation_status')?.intervalSec,
        snapshotCount: count,
        lastSnapshot: snapshot.timestampStart,
        lastDurationMs: snapshot.durationMs,
      });

      // Log deltas summary
      if (snapshot.deltas) {
        const keys = Object.keys(snapshot.deltas);
        const exactMatches = keys.filter(k => snapshot.deltas[k].absDiff === 0).length;
        (this as any).appendLog?.('VALID', `Snapshot #${count}: ${exactMatches}/${keys.length} exact matches, duration=${snapshot.durationMs}ms`);
      }

    } catch (err: any) {
      (this as any).appendLog?.('ERROR', 'Validation cycle failed: ' + err.message);
    }
  }

  private _stopModbusValidation() {
    if ((this as any)._validationInterval) {
      clearInterval((this as any)._validationInterval);
      (this as any)._validationInterval = null;
    }

    // Persist final state
    const validator = (this as any)._validator;
    if (validator) {
      this.homey.settings.set('validation_snapshots', validator.getSnapshots());
      this.homey.settings.set('validation_confidence', validator.getConfidence());
    }

    this.homey.settings.set('validation_status', {
      running: false,
      stoppedAt: new Date().toISOString(),
      snapshotCount: validator ? validator.getSnapshots().length : 0,
    });
    (this as any).appendLog?.('INFO', 'Modbus validation stopped');
  }

  private _exportValidationData() {
    const validator = (this as any)._validator;
    if (!validator) {
      this.homey.settings.set('validation_export', { error: 'No validation data. Start validation first.' });
      return;
    }
    const data = validator.exportData();
    this.homey.settings.set('validation_export', data);
    (this as any).appendLog?.('INFO', `Validation data exported: ${data.snapshots.length} snapshots, ${Object.keys(data.confidence).length} candidates`);
  }

  private _clearValidationData() {
    const validator = (this as any)._validator;
    if (validator) validator.clearData();
    this.homey.settings.set('validation_snapshots', null);
    this.homey.settings.set('validation_confidence', null);
    this.homey.settings.set('validation_export', null);
    this.homey.settings.set('validation_status', { running: false, snapshotCount: 0 });
    (this as any).appendLog?.('INFO', 'Validation data cleared');
  }

  private async _runModbusEssProbe() {
    try {
      (this as any).appendLog?.('INFO', 'Modbus ESS probe requested (experimental)...');
      const client = this._createModbusClient();
      if (!client) {
        this.homey.settings.set('modbus_ess_probe_result', { error: 'No gateway IP configured in app settings.' });
        return;
      }

      const result = await client.probeEssRegisters();
      this.homey.settings.set('modbus_ess_probe_result', result || { found: false, message: 'No plausible ESS data found in candidate register blocks.' });
      (this as any).appendLog?.('INFO', 'ESS probe complete: ' + (result?.found ? `Found at ${result.block}` : 'No ESS data found'));
    } catch (err: any) {
      this.homey.settings.set('modbus_ess_probe_result', { error: 'ESS probe failed: ' + err.message });
      (this as any).appendLog?.('ERROR', 'Modbus ESS probe failed: ' + err.message);
    }
  }

}
