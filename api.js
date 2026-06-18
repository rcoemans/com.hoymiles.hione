'use strict';

module.exports = {
  async testLogin({ homey, body }) {
    return homey.app.apiLogin(body);
  },

  async forgetLogin({ homey }) {
    return { success: true };
  },

  async getDiagnostics({ homey }) {
    return homey.app.apiGetDiagnostics();
  },

  async startDiagnostics({ homey, body }) {
    return homey.app.apiStartDiagnostics(body);
  },

  async stopDiagnostics({ homey }) {
    return homey.app.apiStopDiagnostics();
  },

  async clearDiagnostics({ homey }) {
    return homey.app.apiClearDiagnostics();
  },

  async exportDiagnostics({ homey }) {
    return homey.app.apiExportDiagnostics();
  },
};
