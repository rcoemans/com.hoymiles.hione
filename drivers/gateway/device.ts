import Homey from 'homey';

class GatewayDevice extends Homey.Device {
  _prevOnline: boolean | null = null;

  async onInit() {
    this.log('GatewayDevice initialised:', this.getName());
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
      const hasData = !!snapshot.merged;
      const online = hasData && !snapshot.error;

      await this._setCapSafe('hoymiles_gateway_online', online);
      await this._setCapSafe('hoymiles_system_state', online ? 'online_cloud' : 'offline');
      await this._setCapSafe('alarm_generic', !online);
      await this._setCapSafe('hoymiles_last_update', new Date().toLocaleTimeString());

      // Gateway online/offline triggers
      if (this._prevOnline !== null && this._prevOnline !== online) {
        const app = this.homey.app as any;
        if (online) {
          app._triggerGatewayCameOnline?.trigger(this).catch(() => {});
        } else {
          app._triggerGatewayWentOffline?.trigger(this).catch(() => {});
        }
      }
      this._prevOnline = online;
    } catch (err: any) {
      this.error('Gateway snapshot error:', err.message);
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

module.exports = GatewayDevice;
