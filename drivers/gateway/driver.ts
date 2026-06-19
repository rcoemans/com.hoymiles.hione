import Homey from 'homey';

class GatewayDriver extends Homey.Driver {

  async onInit() {
    this.log('GatewayDriver initialised');
  }

  async onPair(session: any) {
    let parentDevice: any = null;

    session.setHandler('getStationDevices', async () => {
      const stationDriver = this.homey.drivers.getDriver('station');
      const devices = stationDriver.getDevices();
      return devices.map((d: any) => ({
        id: d.getData().id,
        name: d.getName(),
        plantId: d.getData().plantId,
      }));
    });

    session.setHandler('selectParent', async (parentId: string) => {
      const stationDriver = this.homey.drivers.getDriver('station');
      parentDevice = stationDriver.getDevices().find((d: any) => d.getData().id === parentId);
      return !!parentDevice;
    });

    session.setHandler('list_devices', async () => {
      if (!parentDevice) return [];
      const store = parentDevice.getStore();
      const deviceList = store.deviceList || [];
      const gateways = deviceList.filter((d: any) => d.type === 'gateway');

      return gateways.map((gw: any) => ({
        name: `Gateway ${gw.sn || gw.model || '?'}`,
        data: {
          id: `${parentDevice.getData().plantId}:gateway:${gw.sn}`,
          plantId: parentDevice.getData().plantId,
          parentId: parentDevice.getData().id,
          type: 'gateway',
          sn: gw.sn,
        },
        settings: {
          system_info: [
            'Appliance: Gateway',
            `Model: ${gw.model || '-'}`,
            `Serial: ${gw.sn || '-'}`,
            `Firmware: ${gw.firmware || '-'}`,
            `Hardware: ${gw.hardware || '-'}`,
          ].join('\n'),
        },
      }));
    });
  }
}

module.exports = GatewayDriver;
