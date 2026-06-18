import Homey from 'homey';

const { PollingService } = require('./lib/PollingService');
const { DiagnosticsEngine } = require('./lib/DiagnosticsEngine');
const { BATTERY_MODES } = require('./lib/HoymilesApi');

class HoymilesHiOneApp extends Homey.App {
  pollingService!: any;
  diagnostics!: any;

  _triggerBatteryModeChanged!: any;
  _triggerBatterySocRoseAbove!: any;
  _triggerBatterySocDroppedBelow!: any;
  _triggerBatteryStartedCharging!: any;
  _triggerBatteryStartedDischarging!: any;
  _triggerBatteryStoppedCharging!: any;
  _triggerBatteryStoppedDischarging!: any;
  _triggerConnectionSourceChanged!: any;
  _triggerGatewayCameOnline!: any;
  _triggerGatewayWentOffline!: any;
  _triggerGridStartedExporting!: any;
  _triggerGridStartedImporting!: any;
  _triggerPvProductionStarted!: any;
  _triggerPvProductionStopped!: any;

  async onInit() {
    this.log('HoymilesHiOneApp v2.0.0 initialising...');

    this.pollingService = new PollingService({
      log: this.log.bind(this),
      error: this.error.bind(this),
    });

    this.diagnostics = new DiagnosticsEngine({
      log: this.log.bind(this),
      error: this.error.bind(this),
    });

    this._registerFlowCards();

    this.log('HoymilesHiOneApp initialised');
  }

  async onUninit() {
    this.diagnostics.stop();
  }

  _registerFlowCards() {
    // ── TRIGGERS ──
    // Most triggers fire from the device driver, so we just get references
    this._triggerBatteryModeChanged     = this.homey.flow.getDeviceTriggerCard('battery_mode_changed');
    this._triggerBatterySocRoseAbove    = this.homey.flow.getDeviceTriggerCard('battery_soc_rose_above');
    this._triggerBatterySocDroppedBelow = this.homey.flow.getDeviceTriggerCard('battery_soc_dropped_below');
    this._triggerBatteryStartedCharging      = this.homey.flow.getDeviceTriggerCard('battery_started_charging');
    this._triggerBatteryStartedDischarging   = this.homey.flow.getDeviceTriggerCard('battery_started_discharging');
    this._triggerBatteryStoppedCharging      = this.homey.flow.getDeviceTriggerCard('battery_stopped_charging');
    this._triggerBatteryStoppedDischarging   = this.homey.flow.getDeviceTriggerCard('battery_stopped_discharging');
    this._triggerConnectionSourceChanged     = this.homey.flow.getDeviceTriggerCard('connection_source_changed');
    this._triggerGatewayCameOnline    = this.homey.flow.getDeviceTriggerCard('gateway_came_online');
    this._triggerGatewayWentOffline   = this.homey.flow.getDeviceTriggerCard('gateway_went_offline');
    this._triggerGridStartedExporting = this.homey.flow.getDeviceTriggerCard('grid_started_exporting');
    this._triggerGridStartedImporting = this.homey.flow.getDeviceTriggerCard('grid_started_importing');
    this._triggerPvProductionStarted  = this.homey.flow.getDeviceTriggerCard('pv_production_started');
    this._triggerPvProductionStopped  = this.homey.flow.getDeviceTriggerCard('pv_production_stopped');

    // SoC threshold triggers need a runListener to evaluate the threshold arg
    this._triggerBatterySocRoseAbove.registerRunListener(async (args: any, state: any) => {
      return state.soc >= args.soc;
    });
    this._triggerBatterySocDroppedBelow.registerRunListener(async (args: any, state: any) => {
      return state.soc <= args.soc;
    });

    // ── CONDITIONS ──
    const condBatteryModeIs = this.homey.flow.getConditionCard('battery_mode_is');
    condBatteryModeIs.registerRunListener(async (args: any, state: any) => {
      const device = args.device;
      const current = await device.getCapabilityValue('hoymiles_battery_mode');
      return current === args.mode;
    });

    const condBatteryCharging = this.homey.flow.getConditionCard('battery_charging');
    condBatteryCharging.registerRunListener(async (args: any) => {
      const state = await args.device.getCapabilityValue('hoymiles_battery_state');
      return state === 'charging';
    });

    const condBatteryDischarging = this.homey.flow.getConditionCard('battery_discharging');
    condBatteryDischarging.registerRunListener(async (args: any) => {
      const state = await args.device.getCapabilityValue('hoymiles_battery_state');
      return state === 'discharging';
    });

    const condSocAbove = this.homey.flow.getConditionCard('battery_soc_above');
    condSocAbove.registerRunListener(async (args: any) => {
      const soc = await args.device.getCapabilityValue('measure_battery');
      return (soc || 0) >= args.soc;
    });

    const condSocBelow = this.homey.flow.getConditionCard('battery_soc_below');
    condSocBelow.registerRunListener(async (args: any) => {
      const soc = await args.device.getCapabilityValue('measure_battery');
      return (soc || 0) <= args.soc;
    });

    const condConnectionLocal = this.homey.flow.getConditionCard('connection_is_local');
    condConnectionLocal.registerRunListener(async (args: any) => {
      const src = await args.device.getCapabilityValue('hoymiles_connection_source');
      return src === 'local';
    });

    const condGatewayOnline = this.homey.flow.getConditionCard('gateway_is_online');
    condGatewayOnline.registerRunListener(async (args: any) => {
      return await args.device.getCapabilityValue('hoymiles_gateway_online') === true;
    });

    const condGridExporting = this.homey.flow.getConditionCard('grid_is_exporting');
    condGridExporting.registerRunListener(async (args: any) => {
      const state = await args.device.getCapabilityValue('hoymiles_grid_state');
      return state === 'exporting';
    });

    const condGridImporting = this.homey.flow.getConditionCard('grid_is_importing');
    condGridImporting.registerRunListener(async (args: any) => {
      const state = await args.device.getCapabilityValue('hoymiles_grid_state');
      return state === 'importing';
    });

    const condLoadPowerAbove = this.homey.flow.getConditionCard('load_power_above');
    condLoadPowerAbove.registerRunListener(async (args: any) => {
      const power = await args.device.getCapabilityValue('hoymiles_load_power');
      return (power || 0) >= args.watts;
    });

    const condPvPowerAbove = this.homey.flow.getConditionCard('pv_power_above');
    condPvPowerAbove.registerRunListener(async (args: any) => {
      const power = await args.device.getCapabilityValue('hoymiles_pv_power');
      return (power || 0) >= args.watts;
    });

    // ── ACTIONS ──
    const actSetBatteryMode = this.homey.flow.getActionCard('set_battery_mode');
    actSetBatteryMode.registerRunListener(async (args: any) => {
      await args.device.onActionSetBatteryMode(args.mode);
    });

    const actSetReserveSoc = this.homey.flow.getActionCard('set_reserve_soc');
    actSetReserveSoc.registerRunListener(async (args: any) => {
      await args.device.onActionSetReserveSoc(args.soc);
    });

    const actSetMaxSoc = this.homey.flow.getActionCard('set_max_soc');
    actSetMaxSoc.registerRunListener(async (args: any) => {
      await args.device.onActionSetMaxSoc(args.soc);
    });

    const actSetMaxChargePower = this.homey.flow.getActionCard('set_max_charge_power');
    actSetMaxChargePower.registerRunListener(async (args: any) => {
      await args.device.onActionSetMaxChargePower(args.power);
    });

    const actSetMaxDischargePower = this.homey.flow.getActionCard('set_max_discharge_power');
    actSetMaxDischargePower.registerRunListener(async (args: any) => {
      await args.device.onActionSetMaxDischargePower(args.power);
    });

    const actSetGridLimit = this.homey.flow.getActionCard('set_grid_limit');
    actSetGridLimit.registerRunListener(async (args: any) => {
      await args.device.onActionSetGridLimit(args.watts);
    });

    const actRefreshData = this.homey.flow.getActionCard('refresh_data');
    actRefreshData.registerRunListener(async (args: any) => {
      await args.device.onActionRefreshData();
    });

    const actSetInverterState = this.homey.flow.getActionCard('set_inverter_state');
    actSetInverterState.registerRunListener(async (args: any) => {
      await args.device.onActionSetInverterState(args.serial, args.state === 'on');
    });

    const actSetTouPeriod = this.homey.flow.getActionCard('set_tou_period');
    actSetTouPeriod.registerRunListener(async (args: any) => {
      await args.device.onActionSetTouPeriod({
        chargeFrom:     args.charge_from,
        chargeTo:       args.charge_to,
        chargePower:    args.charge_power,
        chargeSoc:      args.charge_soc,
        dischargeFrom:  args.discharge_from,
        dischargeTo:    args.discharge_to,
        dischargePower: args.discharge_power,
        dischargeSoc:   args.discharge_soc,
      });
    });

    const actSetPeakShaving = this.homey.flow.getActionCard('set_peak_shaving');
    actSetPeakShaving.registerRunListener(async (args: any) => {
      await args.device.onActionSetPeakShaving({
        reserveSoc: args.reserve_soc,
        maxSoc:     args.max_soc,
        gridLimit:  args.meter_power,
      });
    });

    const actSetRelay = this.homey.flow.getActionCard('set_relay');
    actSetRelay.registerRunListener(async (args: any) => {
      await args.device.onActionSetRelay(args.state === 'on');
    });

    const actSetPowerLimit = this.homey.flow.getActionCard('set_power_limit');
    actSetPowerLimit.registerRunListener(async (args: any) => {
      await args.device.onActionSetPowerLimit(args.limit);
    });
  }

  // Public API for diagnostics (called from api.js)
  async apiLogin(body: any) {
    // Test login only — used by settings page
    const { HoymilesApi } = require('./lib/HoymilesApi');
    const api = new HoymilesApi({ log: this.log.bind(this), error: this.error.bind(this) });
    try {
      await api.login(body.email, body.password, body.mode || 'auto');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  apiGetDiagnostics() {
    return this.diagnostics.getStatus();
  }

  apiStartDiagnostics(body: any) {
    const config = body || {};
    this.diagnostics.start(config, (config.intervalMs || 60) * 1000);
    return { started: true };
  }

  apiStopDiagnostics() {
    this.diagnostics.stop();
    return { stopped: true };
  }

  apiClearDiagnostics() {
    this.diagnostics.clear();
    return { cleared: true };
  }

  apiExportDiagnostics() {
    return this.diagnostics.export();
  }
}

module.exports = HoymilesHiOneApp;
