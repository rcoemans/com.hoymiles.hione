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
    let _gatewayPort: number      = 10081;

    const _api = new HoymilesApi({
      log:     this.log.bind(this),
      error:   this.error.bind(this),
      baseUrl: this.homey.settings.get('cloud_api_url') || undefined,
    });

    // Read app-level settings as defaults
    const appIp   = this.homey.settings.get('gateway_ip') || null;
    const appPort = this.homey.settings.get('gateway_port') || 10081;
    if (appIp)   _gatewayIp   = appIp;
    if (appPort) _gatewayPort = Number(appPort) || 10081;

    // Step 1: user picks connection mode
    session.setHandler('set_connection_mode', async ({ mode }: { mode: string }) => {
      _mode = mode;
      this.log('Connection mode: ' + mode);
      return true;
    });

    // Step 2a: local IP + port
    session.setHandler('set_gateway_ip', async ({ ip, port }: { ip: string; port?: number }) => {
      _gatewayIp = ip || null;
      _gatewayPort = (port && port > 0) ? port : 10081;
      this.log('Gateway IP: ' + (_gatewayIp || 'none') + ':' + _gatewayPort);
      return true;
    });

    // Step 2b: cloud login — uses auth matrix (v3 web, v3 installer, legacy v0)
    session.setHandler('login', async ({ username, password }: { username: string; password: string }) => {
      _email    = username;
      _password = password;
      try {
        const result = await _api.authenticate(_email, _password, { mode: 'auto' });
        this.log('Auth succeeded via ' + result.mode + '/' + result.profile);
        return true;
      } catch (err: any) {
        const summary = _api.getSanitizedAuthSummary?.() || [];
        this.error('Login failed: ' + err.message, JSON.stringify(summary));
        // Return error message string — do NOT throw, as that can kill the pairing session
        return err.message || 'Authentication failed';
      }
    });

    // Let pair views query the chosen connection mode
    session.setHandler('get_connection_mode', async () => _mode);

    // Let pair views get default values from app settings
    session.setHandler('get_defaults', async () => ({
      gatewayIp:   _gatewayIp || '',
      gatewayPort: _gatewayPort,
      username:    this.homey.settings.get('cloud_username') || '',
      password:    this.homey.settings.get('cloud_password') || '',
    }));

    // Final step: build device list
    session.setHandler('list_devices', async () => {
      // LOCAL-ONLY: probe the gateway and create a single device
      if (_mode === 'local') {
        if (!_gatewayIp) throw new Error('No IP address provided');

        const local = new HoymilesLocal({
          host:  _gatewayIp,
          port:  _gatewayPort,
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
          store:    { email: null, password: null, gatewayIp: _gatewayIp, gatewayPort: _gatewayPort, connectionMode: _mode },
          settings: { connection_mode: _mode, gateway_ip: _gatewayIp, gateway_port: _gatewayPort },
        }];
      }

      // CLOUD or BOTH: fetch stations from S-Miles Cloud
      const stations = await _api.getStations();
      return stations.map((s: any) => ({
        name:     s.name,
        data:     { id: s.id, stationId: s.id },
        store:    { email: _email, password: _password, gatewayIp: _gatewayIp, gatewayPort: _gatewayPort, connectionMode: _mode },
        settings: { connection_mode: _mode, cloud_username: _email || '', cloud_password: _password || '', gateway_ip: _gatewayIp || '', gateway_port: _gatewayPort },
      }));
    });
  }

}
