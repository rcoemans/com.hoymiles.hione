'use strict';

const net = require('net');

const DEFAULT_PORT    = 10081;
const CONNECT_TIMEOUT = 5000;
const READ_TIMEOUT    = 10000;

class ProtobufClient {
  constructor({ host, port = DEFAULT_PORT, log = console.log, error = console.error } = {}) {
    this.host   = host;
    this.port   = port;
    this._log   = log;
    this._error = error;
  }

  async sendCommand(commandBuffer) {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket();
      const chunks = [];
      let done = false;

      const finish = (err, data) => {
        if (done) return;
        done = true;
        sock.destroy();
        if (err) reject(err); else resolve(data);
      };

      sock.setTimeout(READ_TIMEOUT);
      sock.on('timeout', () => finish(new Error('Protobuf read timeout')));
      sock.on('error', (err) => finish(err));
      sock.on('data', (chunk) => {
        chunks.push(chunk);
        const buf = Buffer.concat(chunks);
        if (this._isComplete(buf)) finish(null, buf);
      });

      sock.connect(this.port, this.host, () => sock.write(commandBuffer));
      setTimeout(() => finish(new Error('Protobuf connect timeout')), CONNECT_TIMEOUT);
    });
  }

  _isComplete(buf) {
    if (buf.length < 4) return false;
    const payloadLen = buf.readUInt16BE(2);
    return buf.length >= 4 + payloadLen;
  }

  buildGetRealDataCommand(dtuSn) {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0x4857, 0);

    const snBuf = Buffer.from(dtuSn, 'utf-8');
    const cmdBuf = Buffer.alloc(2);
    cmdBuf.writeUInt16BE(0x0102, 0);

    const payload = Buffer.concat([cmdBuf, snBuf]);
    header.writeUInt16BE(payload.length, 2);

    return Buffer.concat([header, payload]);
  }

  buildSetPowerLimitCommand(dtuSn, inverterSn, limitPercent) {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0x4857, 0);

    const cmdBuf = Buffer.alloc(2);
    cmdBuf.writeUInt16BE(0x0501, 0);

    const dtuBuf = Buffer.from(dtuSn, 'utf-8');
    const invBuf = Buffer.from(inverterSn, 'utf-8');
    const valBuf = Buffer.alloc(2);
    valBuf.writeUInt16BE(Math.round(limitPercent * 10), 0);

    const sep = Buffer.from([0x00]);
    const payload = Buffer.concat([cmdBuf, dtuBuf, sep, invBuf, sep, valBuf]);
    header.writeUInt16BE(payload.length, 2);

    return Buffer.concat([header, payload]);
  }

  buildSetOnOffCommand(dtuSn, inverterSn, turnOn) {
    const header = Buffer.alloc(4);
    header.writeUInt16BE(0x4857, 0);

    const cmdBuf = Buffer.alloc(2);
    cmdBuf.writeUInt16BE(turnOn ? 0x0401 : 0x0400, 0);

    const dtuBuf = Buffer.from(dtuSn, 'utf-8');
    const invBuf = Buffer.from(inverterSn, 'utf-8');
    const sep = Buffer.from([0x00]);

    const payload = Buffer.concat([cmdBuf, dtuBuf, sep, invBuf]);
    header.writeUInt16BE(payload.length, 2);

    return Buffer.concat([header, payload]);
  }

  parseRealDataResponse(buf) {
    if (buf.length < 4) return null;
    const magic = buf.readUInt16BE(0);
    if (magic !== 0x4857) return null;

    try {
      const payloadLen = buf.readUInt16BE(2);
      const payload = buf.slice(4, 4 + payloadLen);
      return { raw: payload, hex: payload.toString('hex'), length: payloadLen };
    } catch (_) {
      return null;
    }
  }

  async getRealData(dtuSn) {
    const cmd = this.buildGetRealDataCommand(dtuSn);
    const response = await this.sendCommand(cmd);
    return this.parseRealDataResponse(response);
  }

  async setInverterPowerLimit(dtuSn, inverterSn, limitPercent) {
    const cmd = this.buildSetPowerLimitCommand(dtuSn, inverterSn, limitPercent);
    const response = await this.sendCommand(cmd);
    return this.parseRealDataResponse(response);
  }

  async setInverterOnOff(dtuSn, inverterSn, turnOn) {
    const cmd = this.buildSetOnOffCommand(dtuSn, inverterSn, turnOn);
    const response = await this.sendCommand(cmd);
    return this.parseRealDataResponse(response);
  }

  async probe() {
    try {
      const dummy = this.buildGetRealDataCommand('000000000000');
      await this.sendCommand(dummy);
      return true;
    } catch (_) {
      return false;
    }
  }
}

module.exports = { ProtobufClient };
