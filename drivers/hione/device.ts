'use strict';

import Homey from 'homey';

const HoymilesHybrid = require('../../lib/HoymilesHybrid');
const HioneMapper = require('../../lib/HioneMapper');
const HioneCalculator = require('../../lib/HioneCalculator');
const { BATTERY_MODES } = require('../../lib/HoymilesApi');

const DEFAULT_POLL_MS = 60_000;

module.exports = class HiOneDevice extends Homey.Device {

  private _hybrid: any;
  private _pollInterval: any;
  private _prevBatteryMode: string | null = null;
  private _prevBatteryState: string | null = null;
  private _prevGridState: string | null = null;
  private _prevSoc: number | null = null;
  private _prevPvProducing: boolean | null = null;
  private _prevGatewayOnline: boolean | null = null;
  private _prevConnectionSource: string | null = null;

  async onInit() {
    this.log('HiOne device initialising...');
    this._prevBatteryMode = null;
    this._prevBatteryState = null;
    this._prevGridState = null;
    this._prevSoc = null;
    this._prevPvProducing = null;
    this._prevGatewayOnline = null;
    this._prevConnectionSource = null;

    this._createHybrid();
    this._hybrid.probeLocal().then(() => this._fetchGatewayInfo()).catch(() => {});

    this.registerCapabilityListener('hione_battery_mode', async (value: string) => {
      await this._hybrid.setBatteryMode(value);
    });

    this._startPolling();
    await this._poll();
    this.log('HiOne device ready');
  }

  async onDeleted() {
    this._stopPolling();
    this.log('HiOne device removed');
  }

  async onSettings({ newSettings, changedKeys }: { newSettings: any; changedKeys: string[] }) {
    if (changedKeys.includes('gateway_ip') || changedKeys.includes('cloud_api_url')) {
      this.log('Connection settings changed — reinitialising');
      this._createHybrid();
      this._hybrid.probeLocal().catch(() => {});
    }
    if (changedKeys.includes('poll_interval')) {
      this.log('Poll interval changed to ' + newSettings.poll_interval + 's');
      this._startPolling();
    }
  }

  // ── Public methods for flow actions ─────────────────────────────────────

  async setBatteryMode(mode: string) {
    await this._hybrid.setBatteryMode(mode);
    await this.setCapabilityValue('hione_battery_mode', String(mode));
  }

  async pollNow() {
    await this._poll();
  }

  async preferLocal() {
    this._hybrid.forceLocal();
    await this._poll();
  }

  async preferCloud() {
    this._hybrid.forceCloud();
    await this._poll();
  }

  async setCloudFallback(enabled: boolean) {
    this._hybrid.setCloudFallback(enabled);
  }

  // ── Polling ─────────────────────────────────────────────────────────────

  private _getPollMs(): number {
    const seconds = this.getSetting('poll_interval') || 60;
    return Math.max(30, Math.min(300, seconds)) * 1000;
  }

  private _startPolling() {
    this._stopPolling();
    const ms = this._getPollMs();
    this._pollInterval = this.homey.setInterval(() => this._poll(), ms);
    this.log('Polling every ' + (ms / 1000) + 's');
  }

  private _stopPolling() {
    if (this._pollInterval) {
      this.homey.clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  private async _poll() {
    try {
      const rawData = await this._hybrid.getData();
      const data = HioneMapper.normalize(rawData);

      // ── Core capabilities ────────────────────────────────────────────

      await this.setCapabilityValue('measure_power', data.pvPower);
      await this.setCapabilityValue('measure_battery', data.batterySoc);
      await this.setCapabilityValue('meter_power', data.totalEnergy);
      await this.setCapabilityValue('hione_pv_power', data.pvPower);
      await this.setCapabilityValue('hione_battery_power', data.batteryPower);
      await this.setCapabilityValue('hione_grid_power', data.gridPower);
      await this.setCapabilityValue('hione_load_power', data.loadPower);
      await this.setCapabilityValue('hione_battery_mode', data.batteryMode);
      await this.setCapabilityValue('hione_daily_energy', data.dailyEnergy);
      await this.setCapabilityValue('hione_total_energy', data.totalEnergy);

      // ── Calculated capabilities ──────────────────────────────────────

      const batteryState = HioneCalculator.batteryDirection(data.batteryPower);
      const gridState = HioneCalculator.gridDirection(data.gridPower);
      const selfPoweredPct = HioneCalculator.selfPoweredPct(data.loadPower, data.gridPower);
      const powerBalance = HioneCalculator.powerBalance(data.pvPower, data.gridPower, data.batteryPower, data.loadPower);
      const energyState = HioneCalculator.energyState(data.pvPower, data.gridPower, data.batteryPower, data.loadPower);

      await this.setCapabilityValue('hione_battery_state', batteryState);
      await this.setCapabilityValue('hione_grid_state', gridState);
      await this.setCapabilityValue('hione_self_powered_pct', selfPoweredPct);
      await this.setCapabilityValue('hione_power_balance', powerBalance);
      await this.setCapabilityValue('hione_energy_state', energyState);

      // Runtime estimates
      const dischargePower = data.batteryPower < 0 ? Math.abs(data.batteryPower) : 0;
      const chargePower = data.batteryPower > 0 ? data.batteryPower : 0;
      const runtimeHours = HioneCalculator.batteryRuntimeHours(data.batterySoc, dischargePower);
      const timeToFull = HioneCalculator.timeToFullHours(data.batterySoc, chargePower);

      await this.setCapabilityValue('hione_battery_runtime_hours', runtimeHours ?? 0);
      await this.setCapabilityValue('hione_time_to_full_hours', timeToFull ?? 0);

      // ── Status capabilities ──────────────────────────────────────────

      const systemState = data.source === 'local' ? 'online_local' : 'online_cloud';
      const gatewayOnline = data.source === 'local' || this._hybrid.connectionMode === 'local';

      await this.setCapabilityValue('hione_system_state', systemState);
      await this.setCapabilityValue('hione_connection_source', data.source);
      await this.setCapabilityValue('hione_gateway_online', gatewayOnline);
      await this.setCapabilityValue('hione_last_update', new Date().toLocaleTimeString());

      // ── Flow triggers ────────────────────────────────────────────────

      this._checkBatteryStateTriggers(batteryState);
      this._checkGridStateTriggers(gridState);
      this._checkSocTriggers(data.batterySoc);
      this._checkPvTriggers(data.pvPower);
      this._checkBatteryModeTrigger(data.batteryMode);
      this._checkGatewayTriggers(gatewayOnline);
      this._checkConnectionSourceTrigger(data.source);

      if (!this.getAvailable()) await this.setAvailable();
    } catch (err: any) {
      this.error('Poll failed: ' + err.message);
      await this.setUnavailable(this.homey.__('errors.poll_failed'));
    }
  }

  // ── Trigger helpers ─────────────────────────────────────────────────────

  private _checkBatteryStateTriggers(batteryState: string) {
    if (this._prevBatteryState !== null && batteryState !== this._prevBatteryState) {
      if (batteryState === 'charging') {
        this.homey.flow.getDeviceTriggerCard('battery_started_charging')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
      if (this._prevBatteryState === 'charging' && batteryState !== 'charging') {
        this.homey.flow.getDeviceTriggerCard('battery_stopped_charging')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
      if (batteryState === 'discharging') {
        this.homey.flow.getDeviceTriggerCard('battery_started_discharging')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
      if (this._prevBatteryState === 'discharging' && batteryState !== 'discharging') {
        this.homey.flow.getDeviceTriggerCard('battery_stopped_discharging')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
    }
    this._prevBatteryState = batteryState;
  }

  private _checkGridStateTriggers(gridState: string) {
    if (this._prevGridState !== null && gridState !== this._prevGridState) {
      if (gridState === 'importing') {
        this.homey.flow.getDeviceTriggerCard('grid_started_importing')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
      if (gridState === 'exporting') {
        this.homey.flow.getDeviceTriggerCard('grid_started_exporting')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
    }
    this._prevGridState = gridState;
  }

  private _checkSocTriggers(soc: number) {
    if (this._prevSoc !== null && soc !== this._prevSoc) {
      this.homey.flow.getDeviceTriggerCard('battery_soc_changed')
        .trigger(this, { value: soc }).catch((err: Error) => this.error('Trigger failed: ' + err.message));

      // Threshold triggers are evaluated by the platform via registerRunListener
      this.homey.flow.getDeviceTriggerCard('battery_soc_below_threshold')
        .trigger(this, { value: soc }).catch((err: Error) => this.error('Trigger failed: ' + err.message));

      this.homey.flow.getDeviceTriggerCard('battery_soc_above_threshold')
        .trigger(this, { value: soc }).catch((err: Error) => this.error('Trigger failed: ' + err.message));
    }
    this._prevSoc = soc;
  }

  private _checkPvTriggers(pvPower: number) {
    const producing = pvPower > 10;
    if (this._prevPvProducing !== null && producing !== this._prevPvProducing) {
      if (producing) {
        this.homey.flow.getDeviceTriggerCard('pv_production_started')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      } else {
        this.homey.flow.getDeviceTriggerCard('pv_production_stopped')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
    }
    this._prevPvProducing = producing;
  }

  private _checkBatteryModeTrigger(batteryMode: string) {
    if (this._prevBatteryMode !== null && batteryMode !== this._prevBatteryMode) {
      const modeName = BATTERY_MODES[Number(batteryMode)] || batteryMode;
      this.homey.flow.getDeviceTriggerCard('battery_mode_changed')
        .trigger(this, { mode: modeName })
        .catch((err: Error) => this.error('Trigger failed: ' + err.message));
    }
    this._prevBatteryMode = batteryMode;
  }

  private _checkGatewayTriggers(gatewayOnline: boolean) {
    if (this._prevGatewayOnline !== null && gatewayOnline !== this._prevGatewayOnline) {
      if (gatewayOnline) {
        this.homey.flow.getDeviceTriggerCard('gateway_came_online')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      } else {
        this.homey.flow.getDeviceTriggerCard('gateway_went_offline')
          .trigger(this).catch((err: Error) => this.error('Trigger failed: ' + err.message));
      }
    }
    this._prevGatewayOnline = gatewayOnline;
  }

  private _checkConnectionSourceTrigger(source: string) {
    if (this._prevConnectionSource !== null && source !== this._prevConnectionSource) {
      this.homey.flow.getDeviceTriggerCard('connection_source_changed')
        .trigger(this, { source })
        .catch((err: Error) => this.error('Trigger failed: ' + err.message));
    }
    this._prevConnectionSource = source;
  }

  // ── Gateway info ────────────────────────────────────────────────────────

  private async _fetchGatewayInfo() {
    try {
      const info = await this._hybrid.getGatewayInfo();
      if (!info) return;
      const updates: Record<string, string> = {};
      if (info.dtuSn)       updates.dtu_serial       = info.dtuSn;
      if (info.softwareVer) updates.firmware_version  = info.softwareVer;
      if (info.deviceVer)   updates.hardware_version  = info.deviceVer;
      if (Object.keys(updates).length > 0) {
        await this.setSettings(updates);
        this.log('Gateway info updated: ' + JSON.stringify(updates));
      }
    } catch (err: any) {
      this.log('Could not fetch gateway info: ' + err.message);
    }
  }

  // ── Hybrid instance ─────────────────────────────────────────────────────

  private _createHybrid() {
    const store     = this.getStore();
    const settings  = this.getSettings();
    const gatewayIp = (settings && settings.gateway_ip) || store.gatewayIp || null;

    const baseUrl = (settings && settings.cloud_api_url)
      || this.homey.settings.get('cloud_api_url')
      || undefined;

    this._hybrid = new HoymilesHybrid({
      gatewayIp,
      email:     store.email,
      password:  store.password,
      stationId: this.getData().stationId,
      baseUrl,
      log:       this.log.bind(this),
      error:     this.error.bind(this),
    });
  }

}
