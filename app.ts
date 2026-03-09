'use strict';

import Homey from 'homey';

const HoymilesApi = require('./lib/HoymilesApi');

module.exports = class HoymilesHiOneApp extends Homey.App {

  async onInit() {
    this.log('Hoymiles HiOne app started');

    // Shared API instance; drivers can access via this.homey.app.api
    (this as any).api = new HoymilesApi({
      log:   (...args: any[]) => this.log(...args),
      error: (...args: any[]) => this.error(...args),
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
  }

}
