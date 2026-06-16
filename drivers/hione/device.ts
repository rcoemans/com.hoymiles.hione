'use strict';

import Homey from 'homey';

const HoymilesHybrid = require('../../lib/HoymilesHybrid');
const HioneMapper = require('../../lib/HioneMapper');
const HioneCalculator = require('../../lib/HioneCalculator');
const { BATTERY_MODES } = require('../../lib/HoymilesApi');

const DEFAULT_POLL_MS = 60_000;
const EXTENDED_DATA_INTERVAL = 10; // fetch extended data every N polls

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
  private _consecutiveFailures: number = 0;
  private _pollCount: number = 0;
  private _chargedTotal: number = 0;
  private _dischargedTotal: number = 0;

  private _appLog(level: string, ...args: any[]) {
    try {
      const app = this.homey.app as any;
      if (app && typeof app.appendLog === 'function') app.appendLog(level, ...args);
    } catch (_) {}
  }

  async onInit() {
    this.log('HiOne device initialising...');
    this._prevBatteryMode = null;
    this._prevBatteryState = null;
    this._prevGridState = null;
    this._prevSoc = null;
    this._prevPvProducing = null;
    this._prevGatewayOnline = null;
    this._prevConnectionSource = null;
    this._consecutiveFailures = 0;
    this._pollCount = 0;
    this._chargedTotal = 0;
    this._dischargedTotal = 0;

    // Sync store credentials → device settings (for devices paired before credential settings existed)
    await this._syncStoreToSettings();

    // Capability migration: add new capabilities if missing
    await this._migrateCapabilities();

    this._createHybrid();
    if (this._hybrid._mode !== 'cloud') {
      this._hybrid.probeLocal().then(() => this._fetchDeviceInfo()).catch(() => {});
    } else {
      this._fetchDeviceInfo();
    }

    this.registerCapabilityListener('hione_battery_mode', async (value: string) => {
      await this._hybrid.setBatteryMode(value);
    });

    this.registerCapabilityListener('hione_reserve_soc', async (value: number) => {
      await this._hybrid.writeBatterySettings({ reserveSoc: value });
    });

    this.registerCapabilityListener('hione_max_soc', async (value: number) => {
      await this._hybrid.writeBatterySettings({ maxSoc: value });
    });

    this.registerCapabilityListener('hione_max_power', async (value: number) => {
      await this._hybrid.writeBatterySettings({ maxPower: value });
    });

    this.registerCapabilityListener('hione_grid_limit', async (value: number) => {
      await this._hybrid.writeBatterySettings({ gridLimit: value });
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
    const needsReinit = changedKeys.includes('gateway_ip')
      || changedKeys.includes('gateway_port')
      || changedKeys.includes('cloud_api_url')
      || changedKeys.includes('cloud_username')
      || changedKeys.includes('cloud_password')
      || changedKeys.includes('connection_mode');

    if (needsReinit) {
      // Keep device store in sync with settings
      if (changedKeys.includes('cloud_username') || changedKeys.includes('cloud_password')) {
        await this.setStoreValue('email', newSettings.cloud_username || null).catch(() => {});
        await this.setStoreValue('password', newSettings.cloud_password || null).catch(() => {});
        this.log('Cloud credentials updated via settings');
      }
      this.log('Connection settings changed — reinitialising');
      this._createHybrid();
      this._consecutiveFailures = 0;
      this._hybrid.probeLocal().catch(() => {});
      await this._poll();
    }
    if (changedKeys.includes('poll_interval')) {
      this.log('Poll interval changed to ' + newSettings.poll_interval + 's');
      this._startPolling();
    }
  }

  // ── Capability migration ─────────────────────────────────────────────────

  private async _migrateCapabilities() {
    const needed = [
      'meter_power.charged', 'meter_power.discharged',
      'hione_reserve_soc', 'hione_max_soc', 'hione_max_power', 'hione_grid_limit',
      'hione_monthly_energy', 'hione_yearly_energy',
      'hione_co2_reduction', 'hione_profit_today', 'hione_profit_total',
    ];
    for (const cap of needed) {
      if (!this.hasCapability(cap)) {
        try {
          await this.addCapability(cap);
          this.log(`[Migration] Added capability: ${cap}`);
        } catch (err: any) {
          this.log(`[Migration] Failed to add ${cap}: ${err.message}`);
        }
      }
    }
  }

  // ── Public methods for flow actions ─────────────────────────────────────

  async setBatteryMode(mode: string) {
    await this._hybrid.setBatteryMode(mode);
    await this.setCapabilityValue('hione_battery_mode', String(mode));
  }

  async setReserveSoc(soc: number) {
    await this._hybrid.writeBatterySettings({ reserveSoc: soc });
    await this._safeCap('hione_reserve_soc', soc);
  }

  async setMaxSoc(soc: number) {
    await this._hybrid.writeBatterySettings({ maxSoc: soc });
    await this._safeCap('hione_max_soc', soc);
  }

  async setMaxPower(power: number) {
    await this._hybrid.writeBatterySettings({ maxPower: power });
    await this._safeCap('hione_max_power', power);
  }

  async setGridLimit(limit: number) {
    await this._hybrid.writeBatterySettings({ gridLimit: limit });
    await this._safeCap('hione_grid_limit', limit);
  }

  async setPeakShaving(reserveSoc: number, maxSoc: number, gridLimit: number) {
    await this._hybrid.setBatteryModeWithParams(7, {
      reserve_soc: reserveSoc, max_soc: maxSoc, grid_limit: gridLimit,
    });
    await this._safeCap('hione_battery_mode', '7');
    await this._safeCap('hione_reserve_soc', reserveSoc);
    await this._safeCap('hione_max_soc', maxSoc);
    await this._safeCap('hione_grid_limit', gridLimit);
  }

  async setTouPeriod(chargeFrom: string, chargeTo: string, chargePower: number) {
    await this._hybrid.setBatteryModeWithParams(8, {
      charge_from: chargeFrom, charge_to: chargeTo, charge_power: chargePower,
    });
    await this._safeCap('hione_battery_mode', '8');
  }

  async setPowerLimit(limitPct: number) {
    await this._hybrid.setPowerLimit(limitPct);
  }

  async setInverterState(on: boolean) {
    await this._hybrid.setInverterState(on);
  }

  async setRelay(enabled: boolean) {
    await this._hybrid.setRelay(enabled);
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

  private async _safeCap(id: string, value: any) {
    try {
      await this.setCapabilityValue(id, value);
    } catch (err: any) {
      this.error(`setCapabilityValue(${id}) failed: ${err.message}`);
    }
  }

  private async _poll() {
    try {
      this.log('Polling...');
      this._appLog('DEV', 'Polling...');
      const rawData = await this._hybrid.getData();
      this.log('Raw data received (source: ' + (rawData?.source || 'unknown') + ')');
      this._appLog('DEV', 'Raw data: pv=' + rawData?.pvPower + ' bat=' + rawData?.batteryPower + ' soc=' + rawData?.batterySoc + ' grid=' + rawData?.gridPower + ' load=' + rawData?.loadPower + ' daily=' + rawData?.dailyEnergy + ' total=' + rawData?.totalEnergy + ' mode=' + rawData?.batteryMode);
      const data = HioneMapper.normalize(rawData);
      this._appLog('DEV', 'Mapped: pv=' + data.pvPower + ' bat=' + data.batteryPower + ' soc=' + data.batterySoc + ' grid=' + data.gridPower + ' load=' + data.loadPower + ' chg=' + data.batteryChargePower + ' dis=' + data.batteryDischargePower + ' daily=' + data.dailyEnergy + ' total=' + data.totalEnergy);

      // ── Confidence guard: skip unconfirmed updates when Modbus has no mapping ──
      const conf = (rawData as any)?.confidence;
      const essConfirmed = !conf || conf.batteryPower !== 'none';
      const energyConfirmed = !conf || conf.totalEnergy !== 'none';
      if (conf && (!essConfirmed || !energyConfirmed)) {
        const skipped = [];
        if (!essConfirmed) skipped.push('ESS');
        if (!energyConfirmed) skipped.push('energy');
        this.log('[Poll] Modbus fallback: ' + skipped.join('+') + ' unconfirmed — keeping previous values');
        this._appLog('DEV', 'Modbus fallback active — ' + skipped.join('+') + ' capabilities not updated (confidence: none)');
      }

      // ── Core capabilities ────────────────────────────────────────────

      await this._safeCap('hione_pv_power', data.pvPower);
      if (essConfirmed) {
        await this._safeCap('measure_power', data.batteryPower);
        await this._safeCap('measure_battery', data.batterySoc);
        await this._safeCap('hione_battery_power', data.batteryPower);
        await this._safeCap('hione_grid_power', data.gridPower);
        await this._safeCap('hione_load_power', data.loadPower);
        await this._safeCap('hione_battery_mode', data.batteryMode);
      }
      if (energyConfirmed) {
        await this._safeCap('meter_power', data.totalEnergy);
        await this._safeCap('hione_daily_energy', data.dailyEnergy);
        await this._safeCap('hione_total_energy', data.totalEnergy);
      }

      // ── Split power capabilities ──────────────────────────────────────

      if (essConfirmed) {
        await this._safeCap('hione_battery_charge_power', data.batteryChargePower);
        await this._safeCap('hione_battery_discharge_power', data.batteryDischargePower);
        await this._safeCap('hione_grid_import_power', data.gridImportPower);
        await this._safeCap('hione_grid_export_power', data.gridExportPower);
      }

      // ── Calculated capabilities ──────────────────────────────────────

      const batteryState = essConfirmed ? HioneCalculator.batteryDirection(data.batteryPower) : (this.getCapabilityValue('hione_battery_state') || 'idle');
      const gridState = essConfirmed ? HioneCalculator.gridDirection(data.gridPower) : (this.getCapabilityValue('hione_grid_state') || 'neutral');
      const selfPoweredPct = essConfirmed ? HioneCalculator.selfPoweredPct(data.loadPower, data.gridPower) : (this.getCapabilityValue('hione_self_powered_pct') || 0);
      const powerBalance = essConfirmed ? HioneCalculator.powerBalance(data.pvPower, data.gridPower, data.batteryPower, data.loadPower) : (this.getCapabilityValue('hione_power_balance') || 0);
      const energyState = essConfirmed ? HioneCalculator.energyState(data.pvPower, data.gridPower, data.batteryPower, data.loadPower) : (this.getCapabilityValue('hione_energy_state') || 'self_sufficient');

      await this._safeCap('hione_battery_state', batteryState);
      await this._safeCap('hione_grid_state', gridState);
      await this._safeCap('hione_self_powered_pct', selfPoweredPct);
      await this._safeCap('hione_power_balance', powerBalance);
      await this._safeCap('hione_energy_state', energyState);

      // Runtime estimates
      const dischargePower = data.batteryPower < 0 ? Math.abs(data.batteryPower) : 0;
      const chargePower = data.batteryPower > 0 ? data.batteryPower : 0;
      const runtimeHours = HioneCalculator.batteryRuntimeHours(data.batterySoc, dischargePower);
      const timeToFull = HioneCalculator.timeToFullHours(data.batterySoc, chargePower);

      await this._safeCap('hione_battery_runtime_hours', runtimeHours ?? 0);
      await this._safeCap('hione_time_to_full_hours', timeToFull ?? 0);

      // ── Status capabilities ──────────────────────────────────────────

      const systemState = data.source === 'local' ? 'online_local' : 'online_cloud';
      const gatewayOnline = data.source === 'local' || this._hybrid.connectionMode === 'local';

      await this._safeCap('hione_system_state', systemState);
      await this._safeCap('hione_connection_source', data.source);
      await this._safeCap('hione_gateway_online', gatewayOnline);
      const tz = this.homey.clock.getTimezone();
      const timeStr = new Date().toLocaleTimeString('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      await this._safeCap('hione_last_update', timeStr);

      // ── Flow triggers ────────────────────────────────────────────────

      this._checkBatteryStateTriggers(batteryState);
      this._checkGridStateTriggers(gridState);
      this._checkSocTriggers(data.batterySoc);
      this._checkPvTriggers(data.pvPower);
      this._checkBatteryModeTrigger(data.batteryMode);
      this._checkGatewayTriggers(gatewayOnline);
      this._checkConnectionSourceTrigger(data.source);

      // ── Homey Energy: meter_power charged / discharged ──────────────
      if (essConfirmed) {
        const chargePowerW = data.batteryChargePower || 0;
        const dischargePowerW = data.batteryDischargePower || 0;
        const pollSec = this._getPollMs() / 1000;
        this._chargedTotal += (chargePowerW * pollSec) / 3_600_000; // W·s → kWh
        this._dischargedTotal += (dischargePowerW * pollSec) / 3_600_000;
        await this._safeCap('meter_power.charged', Math.round(this._chargedTotal * 100) / 100);
        await this._safeCap('meter_power.discharged', Math.round(this._dischargedTotal * 100) / 100);
      }

      // ── Extended data (less frequent) ────────────────────────────────
      this._pollCount++;
      if (this._pollCount % EXTENDED_DATA_INTERVAL === 0) {
        this._fetchExtendedData().catch((err: any) =>
          this.log('[Poll] Extended data fetch failed: ' + err.message)
        );
      }

      // ── Alarm ─────────────────────────────────────────────────────────
      await this._safeCap('alarm_generic', false);

      if (this._consecutiveFailures > 0) {
        this.log('Poll recovered after ' + this._consecutiveFailures + ' consecutive failure(s)');
      }
      this._consecutiveFailures = 0;

      if (!this.getAvailable()) await this.setAvailable();
    } catch (err: any) {
      this._consecutiveFailures++;
      this.error('Poll failed (' + this._consecutiveFailures + '/2): ' + err.message);
      this._appLog('DEV-ERR', 'Poll failed (' + this._consecutiveFailures + '/2): ' + err.message);

      if (this._consecutiveFailures >= 2) {
        await this.setCapabilityValue('alarm_generic', true).catch(() => {});
        const reason = err.message ? ` (${err.message})` : '';
        await this.setUnavailable(this.homey.__('errors.poll_failed') + reason);
      }
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

  // ── Extended data (monthly/yearly energy, profit, settings) ────────────

  private async _fetchExtendedData() {
    this.log('[ExtendedData] Fetching...');

    // Monthly / yearly energy
    try {
      const monthly = await this._hybrid.getMonthlyEnergy();
      const yearly = await this._hybrid.getYearlyEnergy();
      await this._safeCap('hione_monthly_energy', monthly);
      await this._safeCap('hione_yearly_energy', yearly);
    } catch (err: any) {
      this.log('[ExtendedData] Energy period fetch failed: ' + err.message);
    }

    // EPS profit + CO2
    try {
      const profit = await this._hybrid.getEpsProfit();
      await this._safeCap('hione_profit_today', profit.profitToday);
      await this._safeCap('hione_profit_total', profit.profitTotal);
      await this._safeCap('hione_co2_reduction', profit.co2Reduction);
    } catch (err: any) {
      this.log('[ExtendedData] EPS profit fetch failed: ' + err.message);
    }

    // Battery settings refresh
    try {
      const settings = await this._hybrid.readBatterySettings();
      if (settings) {
        await this._safeCap('hione_reserve_soc', settings.reserveSoc);
        await this._safeCap('hione_max_soc', settings.maxSoc);
        await this._safeCap('hione_max_power', settings.maxPower);
        await this._safeCap('hione_grid_limit', settings.gridLimit);
      }
    } catch (err: any) {
      this.log('[ExtendedData] Battery settings refresh failed: ' + err.message);
    }
  }

  // ── Device info ────────────────────────────────────────────────────────

  private async _fetchDeviceInfo() {
    const updates: Record<string, string> = {};

    // 1) Try local gateway info (protobuf)
    try {
      const info = await this._hybrid.getGatewayInfo();
      if (info) {
        if (info.dtuSn)       updates.dtu_serial       = info.dtuSn;
        if (info.softwareVer) updates.dtu_firmware      = info.softwareVer;
        if (info.deviceVer)   updates.dtu_hardware      = info.deviceVer;
        this.log('DTU info from local protobuf: ' + JSON.stringify(updates));
      }
    } catch (err: any) {
      this.log('Local gateway info failed: ' + err.message);
    }

    // 2) Try cloud device listing (DTU + inverter + gateway + batteries)
    try {
      const devices = await this._hybrid.getDevices();
      if (devices) {
        if (devices.dtu) {
          if (devices.dtu.sn && !updates.dtu_serial) updates.dtu_serial = devices.dtu.sn;
          if (devices.dtu.firmwareVersion) updates.dtu_firmware = devices.dtu.firmwareVersion;
          if (devices.dtu.hardwareVersion) updates.dtu_hardware = devices.dtu.hardwareVersion;
        }
        if (devices.inverter) {
          if (devices.inverter.sn) updates.inverter_serial = devices.inverter.sn;
          if (devices.inverter.model) updates.inverter_model = devices.inverter.model;
          if (devices.inverter.firmwareVersion) updates.inverter_firmware = devices.inverter.firmwareVersion;
          if (devices.inverter.hardwareVersion) updates.inverter_hardware = devices.inverter.hardwareVersion;
        }
        if (devices.gateway) {
          if (devices.gateway.sn) updates.gateway_serial = devices.gateway.sn;
          if (devices.gateway.model) updates.gateway_model = devices.gateway.model;
          if (devices.gateway.firmwareVersion) updates.gateway_firmware = devices.gateway.firmwareVersion;
          if (devices.gateway.hardwareVersion) updates.gateway_hardware = devices.gateway.hardwareVersion;
        }
        if (devices.batteries && devices.batteries.length > 0) {
          updates.battery_count = String(devices.batteries.length);
          const first = devices.batteries[0];
          if (first.model) updates.battery_model = first.model;
        }
        this.log('Cloud device info: ' + JSON.stringify(updates));
      }
    } catch (err: any) {
      this.log('Cloud device listing failed: ' + err.message);
    }

    // 3) Fallback: station info (limited)
    if (!updates.dtu_serial) {
      try {
        const stationInfo = await this._hybrid.getStationInfo();
        if (stationInfo) {
          if (stationInfo.sn)              updates.dtu_serial  = stationInfo.sn;
          if (stationInfo.firmwareVersion) updates.dtu_firmware = stationInfo.firmwareVersion;
          if (stationInfo.hardwareVersion) updates.dtu_hardware = stationInfo.hardwareVersion;
        }
      } catch (err: any) {
        this.log('Station info fallback failed: ' + err.message);
      }
    }

    // Apply all updates
    if (Object.keys(updates).length > 0) {
      try {
        await this.setSettings(updates);
        this.log('Device info settings updated: ' + Object.keys(updates).join(', '));
      } catch (err: any) {
        this.log('Failed to save device info settings: ' + err.message);
      }
    }
  }

  // ── Hybrid instance ─────────────────────────────────────────────────────

  private async _syncStoreToSettings() {
    try {
      const store = this.getStore();
      const settings = this.getSettings() || {};
      const updates: Record<string, any> = {};
      if (store.email && !settings.cloud_username) updates.cloud_username = store.email;
      if (store.password && !settings.cloud_password) updates.cloud_password = store.password;
      // Migrate connection mode from store for devices paired before the setting existed
      if (store.connectionMode && (!settings.connection_mode || settings.connection_mode === 'both')) {
        updates.connection_mode = store.connectionMode;
      }
      if (Object.keys(updates).length > 0) {
        await this.setSettings(updates);
        this.log('Synced store to device settings: ' + Object.keys(updates).join(', '));
      }
    } catch (err: any) {
      this.log('Could not sync store to settings: ' + err.message);
    }
  }

  private _createHybrid() {
    const store     = this.getStore();
    const settings  = this.getSettings();
    const gatewayIp = (settings && settings.gateway_ip) || store.gatewayIp || null;
    const gatewayPort = (settings && settings.gateway_port) || store.gatewayPort || 10081;

    const baseUrl = (settings && settings.cloud_api_url)
      || this.homey.settings.get('cloud_api_url')
      || undefined;

    // Prefer settings (editable by user) over store (set during pairing)
    const email    = (settings && settings.cloud_username) || store.email    || (this.homey.settings.get('cloud_username') || null);
    const password = (settings && settings.cloud_password) || store.password || (this.homey.settings.get('cloud_password') || null);

    const stationId = this.getData().stationId;
    this.log(`[_createHybrid] email=${email ? '***' : 'null'}, stationId=${stationId}, gatewayIp=${gatewayIp || 'none'}, baseUrl=${baseUrl || 'default'}`);

    // Determine connection mode: explicit setting > store > infer from device data
    let connectionMode = (settings && settings.connection_mode) || store.connectionMode || null;
    if (!connectionMode) {
      // Infer for devices paired before connection_mode existed
      const hasCloud = !!(email && password);
      const hasLocal = !!gatewayIp;
      connectionMode = hasCloud && hasLocal ? 'both' : hasCloud ? 'cloud' : hasLocal ? 'local' : 'cloud';
      this.log(`[_createHybrid] inferred mode=${connectionMode} (no explicit setting)`);
    }
    this.log(`[_createHybrid] mode=${connectionMode}`);

    this._hybrid = new HoymilesHybrid({
      gatewayIp,
      gatewayPort,
      email,
      password,
      stationId,
      baseUrl,
      mode:      connectionMode,
      log:       this.log.bind(this),
      error:     this.error.bind(this),
    });
  }

}
