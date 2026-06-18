'use strict';

const net = require('net');

const FC = { READ_HOLDING: 0x03, READ_INPUT: 0x04, WRITE_SINGLE: 0x06, WRITE_MULTIPLE: 0x10 };
const MAX_REGS_READ   = 125;
const MBAP_HEADER_LEN = 7;
const CONNECT_TIMEOUT = 5000;
const READ_TIMEOUT    = 5000;

const DTU_INFO_BLOCK  = { start: 0x0000, count: 20, label: 'DTU Info' };
const PV_PORT_BLOCK   = { start: 0x1000, stride: 40, maxPorts: 4, label: 'PV Port' };
const PLANT_AGG_BLOCK = { start: 0x2000, count: 40, label: 'Plant Aggregate' };
const ESS_CANDIDATE_BLOCKS = [
  { start: 0x3000, count: 40, label: 'ESS Block 0x3000' },
  { start: 0x3800, count: 40, label: 'ESS Block 0x3800' },
  { start: 0x4000, count: 40, label: 'ESS Block 0x4000' },
  { start: 0x5000, count: 40, label: 'ESS Block 0x5000' },
  { start: 0x6000, count: 40, label: 'ESS Block 0x6000' },
];

const PV_OFFSETS = {
  VOLTAGE:      0, CURRENT:       1, POWER:         2,
  ENERGY_TODAY: 4, ENERGY_TOTAL:  6, GRID_VOLTAGE:  8,
  GRID_FREQ:    9, TEMPERATURE:  10, STATUS:       11,
};

let _txCounter = 0;

function buildReadRequest(unitId, fc, startReg, count) {
  const txId = (_txCounter++) & 0xFFFF;
  const buf = Buffer.alloc(12);
  buf.writeUInt16BE(txId, 0);
  buf.writeUInt16BE(0, 2);
  buf.writeUInt16BE(6, 4);
  buf.writeUInt8(unitId, 6);
  buf.writeUInt8(fc, 7);
  buf.writeUInt16BE(startReg, 8);
  buf.writeUInt16BE(count, 10);
  return { txId, frame: buf };
}

function sendReceive(host, port, frame) {
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
    sock.on('timeout', () => finish(new Error('Modbus read timeout')));
    sock.on('error', (err) => finish(err));

    sock.on('data', (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length < MBAP_HEADER_LEN) return;
      const pduLen = buf.readUInt16BE(4);
      if (buf.length >= MBAP_HEADER_LEN - 1 + pduLen) {
        finish(null, buf);
      }
    });

    sock.connect(port, host, () => sock.write(frame));
    setTimeout(() => finish(new Error('Modbus connect timeout')), CONNECT_TIMEOUT);
  });
}

function parseReadResponse(buf, expectedCount) {
  if (buf.length < MBAP_HEADER_LEN + 2) throw new Error('Response too short');
  const fc = buf[7];
  if (fc & 0x80) throw new Error(`Modbus exception: code ${buf[8]}`);
  const byteCount = buf[8];
  if (byteCount !== expectedCount * 2) throw new Error(`Unexpected byte count: ${byteCount}`);
  const regs = [];
  for (let i = 0; i < expectedCount; i++) {
    regs.push(buf.readUInt16BE(9 + i * 2));
  }
  return regs;
}

class ModbusTcpClient {
  constructor({ host, port = 502, unitId = 1, log = console.log, error = console.error } = {}) {
    this.host   = host;
    this.port   = port;
    this.unitId = unitId;
    this._log   = log;
    this._error = error;
  }

  async readHoldingRegisters(startReg, count) {
    if (count > MAX_REGS_READ) throw new Error(`Cannot read more than ${MAX_REGS_READ} registers`);
    const { frame } = buildReadRequest(this.unitId, FC.READ_HOLDING, startReg, count);
    const response = await sendReceive(this.host, this.port, frame);
    return parseReadResponse(response, count);
  }

  async readInputRegisters(startReg, count) {
    if (count > MAX_REGS_READ) throw new Error(`Cannot read more than ${MAX_REGS_READ} registers`);
    const { frame } = buildReadRequest(this.unitId, FC.READ_INPUT, startReg, count);
    const response = await sendReceive(this.host, this.port, frame);
    return parseReadResponse(response, count);
  }

  async readBlock(block) {
    try {
      const regs = await this.readHoldingRegisters(block.start, block.count);
      return { ok: true, label: block.label, start: block.start, registers: regs };
    } catch (err) {
      return { ok: false, label: block.label, start: block.start, error: err.message };
    }
  }

  u16(regs, offset) { return regs[offset]; }
  s16(regs, offset) { const v = regs[offset]; return v > 32767 ? v - 65536 : v; }
  u32(regs, offset) { return (regs[offset] << 16) | regs[offset + 1]; }

  async readDtuInfo() {
    const result = await this.readBlock(DTU_INFO_BLOCK);
    if (!result.ok) return null;
    return { raw: result.registers, label: result.label };
  }

  async readPvPort(portIndex) {
    const start = PV_PORT_BLOCK.start + portIndex * PV_PORT_BLOCK.stride;
    try {
      const regs = await this.readHoldingRegisters(start, PV_PORT_BLOCK.stride);
      const voltage     = this.u16(regs, PV_OFFSETS.VOLTAGE) / 10;
      const current     = this.u16(regs, PV_OFFSETS.CURRENT) / 100;
      const power       = this.u16(regs, PV_OFFSETS.POWER);
      const dailyEnergy = this.u32(regs, PV_OFFSETS.ENERGY_TODAY) / 100;
      const totalEnergy = this.u32(regs, PV_OFFSETS.ENERGY_TOTAL) / 100;
      const gridVoltage = this.u16(regs, PV_OFFSETS.GRID_VOLTAGE) / 10;
      const gridFreq    = this.u16(regs, PV_OFFSETS.GRID_FREQ) / 100;
      const temperature = this.s16(regs, PV_OFFSETS.TEMPERATURE) / 10;
      return {
        ok: true, portIndex, voltage, current, power,
        dailyEnergy, totalEnergy, gridVoltage, gridFreq, temperature,
        raw: regs,
      };
    } catch (err) {
      return { ok: false, portIndex, error: err.message };
    }
  }

  async readPlantAggregate() {
    const result = await this.readBlock(PLANT_AGG_BLOCK);
    if (!result.ok) return null;
    return { raw: result.registers, label: result.label };
  }

  async scanRegisters(startAddr, endAddr, blockSize = 40) {
    const results = [];
    for (let addr = startAddr; addr < endAddr; addr += blockSize) {
      const count = Math.min(blockSize, endAddr - addr);
      const result = await this.readBlock({ start: addr, count, label: `0x${addr.toString(16)}` });
      results.push(result);
    }
    return results;
  }

  async probeEssRegisters() {
    const results = [];
    for (const block of ESS_CANDIDATE_BLOCKS) {
      const result = await this.readBlock(block);
      results.push(result);
    }
    return results;
  }

  async getData() {
    const snapshot = { pv: null, plant: null, ess: null, dtu: null, confidence: {} };

    try { snapshot.dtu = await this.readDtuInfo(); } catch (_) {}

    try {
      snapshot.plant = await this.readPlantAggregate();
    } catch (_) {
      const ports = [];
      for (let i = 0; i < PV_PORT_BLOCK.maxPorts; i++) {
        const p = await this.readPvPort(i);
        if (p.ok) ports.push(p);
      }
      if (ports.length > 0) {
        snapshot.pv = ports;
        const hasRealisticGrid = ports.some(p =>
          p.gridVoltage >= 80 && p.gridVoltage <= 280 &&
          p.gridFreq >= 45 && p.gridFreq <= 65
        );
        snapshot.confidence.energy = hasRealisticGrid ? 'high' : 'none';
      }
    }

    const essResults = await this.probeEssRegisters();
    const responding = essResults.filter(r => r.ok);
    if (responding.length > 0) {
      snapshot.ess = responding;
      snapshot.confidence.batteryPower = 'low';
    } else {
      snapshot.confidence.batteryPower = 'none';
    }

    return snapshot;
  }
}

module.exports = {
  ModbusTcpClient,
  DTU_INFO_BLOCK,
  PV_PORT_BLOCK,
  PLANT_AGG_BLOCK,
  ESS_CANDIDATE_BLOCKS,
  PV_OFFSETS,
  FC,
};
