import Homey from 'homey';

const { batteryRuntime, timeToFull, DEADBAND_WATTS } = require('../../lib/DataNormalizer');
const { BATTERY_MODES } = require('../../lib/HoymilesApi');
const { ProtobufClient } = require('../../lib/ProtobufClient');

class StationDevice extends Homey.Device {
  _prevBatteryState: string | null = null;
  _prevGridState: string | null = null;
  _prevSoc: number | null = null;
  _prevPvProducing: boolean | null = null;
  _prevGatewayOnline: boolean | null = null;
  _prevConnectionSource: string | null = null;

  async onInit() {
    this.log('StationDevice initialised:', this.getName());

    this._registerCapabilityListeners();
    this._registerWithPollingService();
  }

  async onUninit() {
    const plantId = this.getData().plantId;
    const app = this.homey.app as any;
    app.pollingService.removeListener(plantId, this.getData().id);
  }

  async onSettings({ oldSettings, newSettings, changedKeys }: any) {
    const plantId = this.getData().plantId;
    const app = this.homey.app as any;

    if (changedKeys.includes('poll_interval') ||
        changedKeys.includes('connection_mode') ||
        changedKeys.includes('gateway_ip') ||
        changedKeys.includes('local_protocol') ||
        changedKeys.includes('local_port') ||
        changedKeys.includes('modbus_unit_id') ||
        changedKeys.includes('cloud_api_url')) {
      this._registerWithPollingService();
    }
  }

  _registerWithPollingService() {
    const app = this.homey.app as any;
    const data = this.getData();
    const settings = this.getSettings();
    const store = this.getStore();

    const config = {
      stationId:      store.stationId || data.plantId,
      email:          store.email,
      password:       store.password,
      authMode:       store.authMode,
      dtuSn:          store.dtuSn || '',
      connectionMode: settings.connection_mode || 'cloud',
      gatewayIp:      settings.gateway_ip || '',
      localProtocol:  settings.local_protocol || 'protobuf',
      localPort:      settings.local_port || 10081,
      modbusUnitId:   settings.modbus_unit_id || 1,
      cloudApiUrl:    settings.cloud_api_url || 'https://euapi.hoymiles.com',
    };

    app.pollingService.registerPlant(data.plantId, config);
    app.pollingService.addListener(data.plantId, data.id, (snapshot: any) => {
      this._onSnapshot(snapshot);
    });

    const intervalMs = (settings.poll_interval || 60) * 1000;
    app.pollingService.startPolling(data.plantId, intervalMs);
  }

  async _onSnapshot(snapshot: any) {
    try {
      const d = snapshot.merged;
      if (!d) {
        await this._setCapSafe('hoymiles_system_state', snapshot.error ? 'error' : 'offline');
        return;
      }

      // Connection source
      const src = snapshot.source || 'unknown';
      await this._setCapSafe('hoymiles_connection_source', src);
      if (this._prevConnectionSource !== null && this._prevConnectionSource !== src) {
        const app = this.homey.app as any;
        app._triggerConnectionSourceChanged?.trigger(this, { source: src }).catch(() => {});
      }
      this._prevConnectionSource = src;

      // System state
      const sysState = src === 'cloud' ? 'online_cloud'
        : src === 'local' ? 'online_local'
        : src === 'hybrid' ? 'online_hybrid'
        : 'unknown';
      await this._setCapSafe('hoymiles_system_state', sysState);

      // Power values
      await this._setCapSafe('measure_power', d.batteryPower);
      await this._setCapSafe('hoymiles_pv_power', d.pvPower);
      await this._setCapSafe('hoymiles_grid_power', d.gridPower);
      await this._setCapSafe('hoymiles_load_power', d.loadPower);
      await this._setCapSafe('hoymiles_battery_charge_power', d.batteryChargePower);
      await this._setCapSafe('hoymiles_battery_discharge_power', d.batteryDischargePower);
      await this._setCapSafe('hoymiles_grid_import_power', d.gridImportPower);
      await this._setCapSafe('hoymiles_grid_export_power', d.gridExportPower);

      // SoC
      const soc = d.batterySoc;
      await this._setCapSafe('measure_battery', soc);

      // Battery state
      const battState = d.batteryState;
      await this._setCapSafe('hoymiles_battery_state', battState);
      this._checkBatteryStateTriggers(battState);

      // Battery flow text
      const flowText = battState === 'charging'
        ? `⚡ Charging ${d.batteryChargePower || 0}W`
        : battState === 'discharging'
          ? `🔋 Discharging ${d.batteryDischargePower || 0}W`
          : '— Idle';
      await this._setCapSafe('hoymiles_battery_flow', flowText);

      // Grid state
      const gridState = d.gridState;
      await this._setCapSafe('hoymiles_grid_state', gridState);
      this._checkGridStateTriggers(gridState);

      // SoC thresholds
      this._checkSocTriggers(soc);
      this._prevSoc = soc;

      // PV production triggers
      const pvProducing = (d.pvPower || 0) > DEADBAND_WATTS;
      this._checkPvTriggers(pvProducing);

      // Energy
      await this._setCapSafe('hoymiles_daily_energy', d.dailyEnergy);
      await this._setCapSafe('hoymiles_monthly_energy', d.monthlyEnergy);
      await this._setCapSafe('hoymiles_yearly_energy', d.yearlyEnergy);
      await this._setCapSafe('hoymiles_total_energy', d.totalEnergy);
      await this._setCapSafe('hoymiles_co2_reduction', d.co2Reduction);
      await this._setCapSafe('hoymiles_profit_today', d.profitToday);
      await this._setCapSafe('hoymiles_profit_total', d.profitTotal);

      // Meter power for Homey Energy
      await this._setCapSafe('meter_power.charged', d.batteryChargeEnergy);
      await this._setCapSafe('meter_power.discharged', d.batteryDischargeEnergy);

      // Battery mode
      if (d.touMode != null) {
        await this._setCapSafe('hoymiles_battery_mode', String(d.touMode));
      }

      // Calculated values
      const settings = this.getSettings();
      const reserveSoc = (await this.getCapabilityValue('hoymiles_reserve_soc')) || 0.1;
      const maxSoc     = (await this.getCapabilityValue('hoymiles_max_soc')) || 1;

      await this._setCapSafe('hoymiles_self_powered_pct', d.selfPoweredPct);
      await this._setCapSafe('hoymiles_power_balance', d.powerBalance);

      const runtime = batteryRuntime({
        soc,
        reserveSoc: reserveSoc * 100,
        capacityKwh: 30,
        dischargePower: d.batteryDischargePower,
      });
      await this._setCapSafe('hoymiles_battery_runtime', runtime);

      const ttf = timeToFull({
        soc,
        maxSoc: maxSoc * 100,
        capacityKwh: 30,
        chargePower: d.batteryChargePower,
      });
      await this._setCapSafe('hoymiles_time_to_full', ttf);

      // Timestamp
      await this._setCapSafe('hoymiles_last_update', new Date().toLocaleTimeString());

      // Alarm
      await this._setCapSafe('alarm_generic', false);

    } catch (err: any) {
      this.error('Snapshot processing error:', err.message);
    }
  }

  _checkBatteryStateTriggers(current: string) {
    const prev = this._prevBatteryState;
    if (prev === null) { this._prevBatteryState = current; return; }
    if (prev === current) return;

    const app = this.homey.app as any;
    if (current === 'charging' && prev !== 'charging') {
      app._triggerBatteryStartedCharging?.trigger(this).catch(() => {});
    }
    if (current === 'discharging' && prev !== 'discharging') {
      app._triggerBatteryStartedDischarging?.trigger(this).catch(() => {});
    }
    if (prev === 'charging' && current !== 'charging') {
      app._triggerBatteryStoppedCharging?.trigger(this).catch(() => {});
    }
    if (prev === 'discharging' && current !== 'discharging') {
      app._triggerBatteryStoppedDischarging?.trigger(this).catch(() => {});
    }
    this._prevBatteryState = current;
  }

  _checkGridStateTriggers(current: string) {
    const prev = this._prevGridState;
    if (prev === null) { this._prevGridState = current; return; }
    if (prev === current) return;

    const app = this.homey.app as any;
    if (current === 'exporting' && prev !== 'exporting') {
      app._triggerGridStartedExporting?.trigger(this).catch(() => {});
    }
    if (current === 'importing' && prev !== 'importing') {
      app._triggerGridStartedImporting?.trigger(this).catch(() => {});
    }
    this._prevGridState = current;
  }

  _checkSocTriggers(soc: number | null) {
    if (soc == null || this._prevSoc == null) return;
    const app = this.homey.app as any;

    if (soc > this._prevSoc) {
      app._triggerBatterySocRoseAbove?.trigger(this, {}, { soc }).catch(() => {});
    }
    if (soc < this._prevSoc) {
      app._triggerBatterySocDroppedBelow?.trigger(this, {}, { soc }).catch(() => {});
    }
  }

  _checkPvTriggers(producing: boolean) {
    if (this._prevPvProducing === null) { this._prevPvProducing = producing; return; }
    if (producing === this._prevPvProducing) return;

    const app = this.homey.app as any;
    if (producing && !this._prevPvProducing) {
      app._triggerPvProductionStarted?.trigger(this).catch(() => {});
    }
    if (!producing && this._prevPvProducing) {
      app._triggerPvProductionStopped?.trigger(this).catch(() => {});
    }
    this._prevPvProducing = producing;
  }

  _registerCapabilityListeners() {
    this.registerCapabilityListener('hoymiles_battery_mode', async (value: string) => {
      await this.onActionSetBatteryMode(value);
    });

    this.registerCapabilityListener('hoymiles_reserve_soc', async (value: number) => {
      await this.onActionSetReserveSoc(Math.round(value * 100));
    });

    this.registerCapabilityListener('hoymiles_max_soc', async (value: number) => {
      await this.onActionSetMaxSoc(Math.round(value * 100));
    });

    this.registerCapabilityListener('hoymiles_max_charge_power', async (value: number) => {
      await this.onActionSetMaxChargePower(Math.round(value * 100));
    });

    this.registerCapabilityListener('hoymiles_max_discharge_power', async (value: number) => {
      await this.onActionSetMaxDischargePower(Math.round(value * 100));
    });

    this.registerCapabilityListener('hoymiles_grid_limit', async (value: number) => {
      await this.onActionSetGridLimit(value);
    });
  }

  async _getApi() {
    const app = this.homey.app as any;
    const plantId = this.getData().plantId;
    return app.pollingService.ensureLoggedIn(plantId);
  }

  _getStationId() { return this.getStoreValue('stationId') || this.getData().plantId; }
  _getDtuSn()     { return this.getStoreValue('dtuSn') || ''; }

  // ── Action handlers (called from flow cards and capability listeners) ──

  async onActionSetBatteryMode(mode: string) {
    const api = await this._getApi();
    await api.setBatteryMode(this._getStationId(), this._getDtuSn(), mode);
    await this._setCapSafe('hoymiles_battery_mode', mode);
    const app = this.homey.app as any;
    const label = BATTERY_MODES[Number(mode)] || mode;
    app._triggerBatteryModeChanged?.trigger(this, { mode: label }).catch(() => {});
  }

  async onActionSetReserveSoc(soc: number) {
    const api = await this._getApi();
    await api.setReserveSoc(this._getStationId(), this._getDtuSn(), soc);
    await this._setCapSafe('hoymiles_reserve_soc', soc / 100);
  }

  async onActionSetMaxSoc(soc: number) {
    const api = await this._getApi();
    await api.setMaxSoc(this._getStationId(), this._getDtuSn(), soc);
    await this._setCapSafe('hoymiles_max_soc', soc / 100);
  }

  async onActionSetMaxChargePower(power: number) {
    const api = await this._getApi();
    await api.setMaxChargePower(this._getStationId(), this._getDtuSn(), power);
    await this._setCapSafe('hoymiles_max_charge_power', power / 100);
  }

  async onActionSetMaxDischargePower(power: number) {
    const api = await this._getApi();
    await api.setMaxDischargePower(this._getStationId(), this._getDtuSn(), power);
    await this._setCapSafe('hoymiles_max_discharge_power', power / 100);
  }

  async onActionSetGridLimit(watts: number) {
    const api = await this._getApi();
    await api.setGridLimit(this._getStationId(), this._getDtuSn(), watts);
    await this._setCapSafe('hoymiles_grid_limit', watts);
  }

  async onActionRefreshData() {
    const app = this.homey.app as any;
    await app.pollingService.pollNow(this.getData().plantId);
  }

  async onActionSetInverterState(serial: string, turnOn: boolean) {
    const settings = this.getSettings();
    if (!settings.gateway_ip) throw new Error('No gateway IP configured');
    const client = new ProtobufClient({
      host: settings.gateway_ip,
      port: settings.local_port || 10081,
      log: this.log.bind(this),
      error: this.error.bind(this),
    });
    await client.setInverterOnOff(this._getDtuSn(), serial, turnOn);
  }

  async onActionSetTouPeriod(params: any) {
    const api = await this._getApi();
    await api.setTouPeriod(this._getStationId(), this._getDtuSn(), params);
  }

  async onActionSetPeakShaving(params: any) {
    const api = await this._getApi();
    await api.setPeakShaving(this._getStationId(), this._getDtuSn(), params);
  }

  async onActionSetRelay(enabled: boolean) {
    const api = await this._getApi();
    await api.setRelayEnabled(this._getStationId(), this._getDtuSn(), enabled);
  }

  async onActionSetPowerLimit(limitPercent: number) {
    const settings = this.getSettings();
    if (!settings.gateway_ip) throw new Error('No gateway IP configured');
    const client = new ProtobufClient({
      host: settings.gateway_ip,
      port: settings.local_port || 10081,
      log: this.log.bind(this),
      error: this.error.bind(this),
    });
    const store = this.getStore();
    const inverters = (store.deviceList || []).filter((d: any) => d.type === 'inverter');
    for (const inv of inverters) {
      await client.setInverterPowerLimit(this._getDtuSn(), inv.sn, limitPercent);
    }
  }

  async _setCapSafe(cap: string, value: any) {
    if (value === null || value === undefined) return;
    try {
      if (this.hasCapability(cap)) {
        await this.setCapabilityValue(cap, value);
      }
    } catch (err: any) {
      this.error(`Failed to set ${cap}:`, err.message);
    }
  }
}

module.exports = StationDevice;
