import Homey from 'homey';

class BatteryDriver extends Homey.Driver {

  async onInit() {
    this.log('BatteryDriver initialised');
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
      const batteries = deviceList.filter((d: any) => d.type === 'battery');

      return batteries.map((bat: any) => ({
        name: bat.name || `Battery ${bat.sn}`,
        data: {
          id: `${parentDevice.getData().plantId}:battery:${bat.sn}`,
          plantId: parentDevice.getData().plantId,
          parentId: parentDevice.getData().id,
          type: 'battery',
          sn: bat.sn,
        },
        settings: {
          appliance: 'Battery',
          model: bat.model || '-',
          serial_number: bat.sn || '-',
          firmware_version: bat.firmware || '-',
          hardware_version: bat.hardware || '-',
        },
      }));
    });
  }
}

module.exports = BatteryDriver;
