import Homey from 'homey';

class InverterDevice extends Homey.Device {

  async onInit() {
    this.log('InverterDevice initialised:', this.getName());
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

      // Inverter-specific data would come from device-level API data
      // For now, populate with plant-level PV data as a proxy
      await this._setCapSafe('measure_power', d.pvPower);
      await this._setCapSafe('hoymiles_last_update', new Date().toLocaleTimeString());

      // If cloud snapshot has per-inverter data, use it
      if (snapshot.cloud?.raw) {
        const raw = snapshot.cloud.raw;
        await this._setCapSafe('hoymiles_phase_a_voltage', raw.phase_a_voltage || raw.ua);
        await this._setCapSafe('hoymiles_phase_b_voltage', raw.phase_b_voltage || raw.ub);
        await this._setCapSafe('hoymiles_phase_c_voltage', raw.phase_c_voltage || raw.uc);
        await this._setCapSafe('hoymiles_phase_a_current', raw.phase_a_current || raw.ia);
        await this._setCapSafe('hoymiles_phase_b_current', raw.phase_b_current || raw.ib);
        await this._setCapSafe('hoymiles_phase_c_current', raw.phase_c_current || raw.ic);
        await this._setCapSafe('hoymiles_frequency', raw.frequency || raw.freq);
        await this._setCapSafe('hoymiles_temperature', raw.temperature || raw.temp);
      }
    } catch (err: any) {
      this.error('Inverter snapshot error:', err.message);
    }
  }

  async _setCapSafe(cap: string, value: any) {
    if (value === null || value === undefined) return;
    try {
      if (this.hasCapability(cap)) {
        await this.setCapabilityValue(cap, Number(value));
      }
    } catch (err: any) {
      this.error(`Failed to set ${cap}:`, err.message);
    }
  }
}

module.exports = InverterDevice;
