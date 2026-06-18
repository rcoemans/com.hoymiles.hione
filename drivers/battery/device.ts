import Homey from 'homey';

class BatteryDevice extends Homey.Device {

  async onInit() {
    this.log('BatteryDevice initialised:', this.getName());
    this._registerWithPollingService();
  }

  async onUninit() {
    const data = this.getData();
    const app = this.homey.app as any;
    app.pollingService.removeListener(data.plantId, data.id);
  }

  _registerWithPollingService() {
    const app = this.homey.app as any;
    const data = this.getData();

    app.pollingService.addListener(data.plantId, data.id, (snapshot: any) => {
      this._onSnapshot(snapshot);
    });
  }

  async _onSnapshot(snapshot: any) {
    try {
      const d = snapshot.merged;
      if (!d) return;

      // Plant-level battery data as proxy until per-module API is available
      await this._setCapSafe('measure_battery', d.batterySoc);
      await this._setCapSafe('measure_power', d.batteryPower);
      await this._setCapSafe('hoymiles_battery_state', d.batteryState);
      await this._setCapSafe('hoymiles_last_update', new Date().toLocaleTimeString());

      // Per-battery module data from cloud raw if available
      if (snapshot.cloud?.raw) {
        const raw = snapshot.cloud.raw;
        await this._setCapSafe('hoymiles_battery_voltage', raw.battery_voltage || raw.bat_voltage);
        await this._setCapSafe('hoymiles_battery_current', raw.battery_current || raw.bat_current);
        await this._setCapSafe('hoymiles_battery_soh', raw.battery_soh || raw.soh);
        await this._setCapSafe('hoymiles_max_cell_voltage', raw.max_cell_voltage);
        await this._setCapSafe('hoymiles_min_cell_voltage', raw.min_cell_voltage);
        await this._setCapSafe('hoymiles_max_cell_temp', raw.max_cell_temp);
        await this._setCapSafe('hoymiles_min_cell_temp', raw.min_cell_temp);
      }
    } catch (err: any) {
      this.error('Battery snapshot error:', err.message);
    }
  }

  async _setCapSafe(cap: string, value: any) {
    if (value === null || value === undefined) return;
    try {
      if (this.hasCapability(cap)) {
        const v = typeof value === 'string' ? value : Number(value);
        await this.setCapabilityValue(cap, v);
      }
    } catch (err: any) {
      this.error(`Failed to set ${cap}:`, err.message);
    }
  }
}

module.exports = BatteryDevice;
