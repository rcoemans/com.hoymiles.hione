import Homey from 'homey';

const { HoymilesApi, AUTH_MODE_AUTO } = require('../../lib/HoymilesApi');

class StationDriver extends Homey.Driver {

  async onInit() {
    this.log('StationDriver initialised');
  }

  async onPair(session: any) {
    let api: any = null;
    let stations: any[] = [];
    let selectedStation: any = null;
    let localConfig: any = {};

    // ── Step 1: login_credentials ──

    session.setHandler('get_saved_login', async () => {
      const email = this.homey.settings.get('saved_email');
      return email ? { email } : null;
    });

    session.setHandler('login_saved', async () => {
      const email = this.homey.settings.get('saved_email');
      const password = this.homey.settings.get('saved_password');
      if (!email || !password) return false;
      try {
        api = new HoymilesApi({
          log: this.log.bind(this),
          error: this.error.bind(this),
          baseUrl: this.homey.settings.get('cloud_api_url') || undefined,
        });
        await api.login(email, password, AUTH_MODE_AUTO);
        return true;
      } catch (err: any) {
        this.error('Saved login failed:', err.message);
        return false;
      }
    });

    session.setHandler('forget_login', async () => {
      this.homey.settings.unset('saved_email');
      this.homey.settings.unset('saved_password');
      return true;
    });

    session.setHandler('login', async (data: any) => {
      try {
        api = new HoymilesApi({
          log: this.log.bind(this),
          error: this.error.bind(this),
          baseUrl: data.apiUrl || this.homey.settings.get('cloud_api_url') || undefined,
        });
        await api.login(data.email, data.password, data.authMode || AUTH_MODE_AUTO);
        // Save credentials for next pairing
        this.homey.settings.set('saved_email', data.email);
        this.homey.settings.set('saved_password', data.password);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    // ── Step 2: select_station ──
    session.setHandler('getStations', async () => {
      if (!api) return [];
      try {
        stations = await api.getStations();
        return stations;
      } catch (err: any) {
        this.error('Failed to get stations:', err.message);
        return [];
      }
    });

    session.setHandler('selectStation', async (stationId: string) => {
      selectedStation = stations.find((s: any) => s.id === stationId);
      return selectedStation || null;
    });

    // ── Step 3: configure_local ──
    session.setHandler('setLocalConfig', async (config: any) => {
      localConfig = config || {};
      return true;
    });

    // ── Step 4: list_devices ──
    session.setHandler('list_devices', async () => {
      if (!selectedStation || !api) return [];

      let deviceList: any[] = [];
      try {
        deviceList = await api.getDeviceList(selectedStation.id);
      } catch (err: any) {
        this.error('Failed to get device list:', err.message);
      }

      const dtu = deviceList.find((d: any) => d.type === 'dtu') || {};

      // Build system info as a single multiline string
      const systemInfo = [
        'Appliance: Station',
        `Model: ${dtu.model || '-'}`,
        `Serial: ${dtu.sn || '-'}`,
        `Firmware: ${dtu.firmware || '-'}`,
        `Hardware: ${dtu.hardware || '-'}`,
      ].join('\n');

      const connectedDevices = deviceList.map((d: any) => `${d.type}: ${d.model || '?'} (${d.sn})`).join('\n') || '-';

      const device = {
        name: `${selectedStation.name || 'HiOne Station'} (${selectedStation.id})`,
        data: {
          id: `station:${selectedStation.id}`,
          plantId: selectedStation.id,
          type: 'station',
        },
        store: {
          email: api._email,
          password: api._password,
          authMode: api._authMode || AUTH_MODE_AUTO,
          stationId: selectedStation.id,
          dtuSn: dtu.sn || '',
          deviceList,
        },
        settings: {
          connection_mode: localConfig.connectionMode || 'cloud',
          gateway_ip: localConfig.gatewayIp || '',
          protobuf_port: localConfig.protobufPort || 10081,
          modbus_port: localConfig.modbusPort || 502,
          modbus_unit_id: localConfig.modbusUnitId || 1,
          dtu_sn: dtu.sn || '',
          cloud_api_url: api._baseUrl || 'https://neapi.hoymiles.com',
          system_info: systemInfo,
          connected_devices: connectedDevices,
        },
      };

      return [device];
    });
  }

  async onRepair(session: any, device: any) {
    session.setHandler('login', async (data: any) => {
      try {
        const api = new HoymilesApi({
          log: this.log.bind(this),
          error: this.error.bind(this),
        });
        await api.login(data.email, data.password, data.authMode || AUTH_MODE_AUTO);
        await device.setStoreValue('email', data.email);
        await device.setStoreValue('password', data.password);
        await device.setStoreValue('authMode', data.authMode || AUTH_MODE_AUTO);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    });

    session.setHandler('disconnect', async () => {});
  }
}

module.exports = StationDriver;
