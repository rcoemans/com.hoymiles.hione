import Homey from 'homey';

class InverterDriver extends Homey.Driver {

  async onInit() {
    this.log('InverterDriver initialised');
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
      const inverters = deviceList.filter((d: any) => d.type === 'inverter');

      return inverters.map((inv: any) => ({
        name: inv.name || `Inverter ${inv.sn}`,
        data: {
          id: `${parentDevice.getData().plantId}:inverter:${inv.sn}`,
          plantId: parentDevice.getData().plantId,
          parentId: parentDevice.getData().id,
          type: 'inverter',
          sn: inv.sn,
        },
        settings: {
          appliance: 'Inverter',
          model: inv.model || '-',
          serial_number: inv.sn || '-',
          firmware_version: inv.firmware || '-',
          hardware_version: inv.hardware || '-',
        },
      }));
    });
  }
}

module.exports = InverterDriver;
