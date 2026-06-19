'use strict';

module.exports = {
  async testLogin({ homey, body }) {
    return homey.app.apiLogin(body);
  },

  async saveLogin({ homey, body }) {
    return homey.app.apiSaveLogin(body);
  },

  async logout({ homey }) {
    return homey.app.apiLogout();
  },

  async getSettings({ homey }) {
    return homey.app.apiGetSettings();
  },

  async saveDiagSettings({ homey, body }) {
    return homey.app.apiSaveDiagSettings(body);
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

  async getDiagnosticsReport({ homey }) {
    return homey.app.apiGetDiagnosticsReport();
  },
};
