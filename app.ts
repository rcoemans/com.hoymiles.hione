'use strict';

import Homey from 'homey';

const HoymilesApi      = require('./lib/HoymilesApi');
const ModbusTcpClient  = require('./lib/ModbusTcpClient');

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
