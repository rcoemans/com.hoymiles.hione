'use strict';

import Homey from 'homey';

const HoymilesApi   = require('../../lib/HoymilesApi');
const HoymilesLocal = require('../../lib/HoymilesLocal');

module.exports = class HiOneDriver extends Homey.Driver {

  async onInit() {
    this.log('HiOne driver initialised');
  }

  async onPair(session: any) {
    let _mode      = 'local';   // 'local' | 'cloud' | 'both'
    let _email: string | null     = null;
    let _password: string | null  = null;
    let _gatewayIp: string | null = null;

    const _api = new HoymilesApi({
      log:     this.log.bind(this),
      error:   this.error.bind(this),
      baseUrl: this.homey.settings.get('cloud_api_url') || undefined,
    });

    // Step 1: user picks connection mode
    session.setHandler('set_connection_mode', async ({ mode }: { mode: string }) => {
      _mode = mode;
      this.log('Connection mode: ' + mode);
      return true;
    });

    // Step 2a: local IP
    session.setHandler('set_gateway_ip', async ({ ip }: { ip: string }) => {
      _gatewayIp = ip || null;
      this.log('Gateway IP: ' + (_gatewayIp || 'none'));
      return true;
    });

    // Step 2b: cloud login
    session.setHandler('login', async ({ username, password }: { username: string; password: string }) => {
      _email    = username;
      _password = password;
      try {
        await _api.login(_email, _password);
        return true;
      } catch (err: any) {
        this.error('Login failed: ' + err.message);
        return false;
      }
    });

    // Let pair views query the chosen connection mode
    session.setHandler('get_connection_mode', async () => _mode);

    // Final step: build device list
    session.setHandler('list_devices', async () => {
      // LOCAL-ONLY: probe the gateway and create a single device
      if (_mode === 'local') {
        if (!_gatewayIp) throw new Error('No IP address provided');

        const local = new HoymilesLocal({
          host:  _gatewayIp,
          log:   this.log.bind(this),
          error: this.error.bind(this),
        });

        let name = 'HiOne (' + _gatewayIp + ')';
        try {
          const info = await local.getGatewayInfo();
          if (info.dtuSn) name = 'HiOne ' + info.dtuSn;
        } catch (_) {
          this.log('Could not fetch gateway info — using IP as name');
        }

        return [{
          name,
          data:     { id: _gatewayIp, stationId: null },
          store:    { email: null, password: null, gatewayIp: _gatewayIp },
          settings: { gateway_ip: _gatewayIp },
        }];
      }

      // CLOUD or BOTH: fetch stations from S-Miles Cloud
      const stations = await _api.getStations();
      return stations.map((s: any) => ({
        name:     s.name,
        data:     { id: s.id, stationId: s.id },
        store:    { email: _email, password: _password, gatewayIp: _gatewayIp },
        settings: { gateway_ip: _gatewayIp || '' },
      }));
    });
  }

}
