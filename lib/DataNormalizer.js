'use strict';

const DEADBAND_WATTS   = 10;
const DEFAULT_CAPACITY = 30;

function deriveBatteryState(batteryPower) {
  if (batteryPower == null) return 'idle';
  if (batteryPower > DEADBAND_WATTS) return 'charging';
  if (batteryPower < -DEADBAND_WATTS) return 'discharging';
  return 'idle';
}

function deriveGridState(gridPower) {
  if (gridPower == null) return 'neutral';
  if (gridPower > DEADBAND_WATTS) return 'importing';
  if (gridPower < -DEADBAND_WATTS) return 'exporting';
  return 'neutral';
}

function deriveSplitPower(value) {
  if (value == null) return { positive: 0, negative: 0 };
  return {
    positive: Math.max(0, value),
    negative: Math.max(0, -value),
  };
}

function selfPoweredPct(loadPower, gridImportPower) {
  if (!loadPower || loadPower <= 0) return 100;
  const selfConsumed = Math.max(0, loadPower - (gridImportPower || 0));
  const pct = (selfConsumed / loadPower) * 100;
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

function powerBalance(pvPower, batteryPower, gridPower) {
  return (pvPower || 0) + (batteryPower || 0) + (gridPower || 0);
}

function batteryRuntime({ soc, reserveSoc = 10, capacityKwh = DEFAULT_CAPACITY, dischargePower }) {
  if (!dischargePower || dischargePower <= 0) return null;
  const usablePercent = Math.max(0, (soc || 0) - reserveSoc);
  const usableEnergy  = (usablePercent / 100) * capacityKwh * 1000;
  const hours = usableEnergy / dischargePower;
  return Number.isFinite(hours) ? Math.round(hours * 10) / 10 : null;
}

function timeToFull({ soc, maxSoc = 100, capacityKwh = DEFAULT_CAPACITY, chargePower }) {
  if (!chargePower || chargePower <= 0) return null;
  const remainingPercent = Math.max(0, maxSoc - (soc || 0));
  const remainingEnergy  = (remainingPercent / 100) * capacityKwh * 1000;
  const hours = remainingEnergy / chargePower;
  return Number.isFinite(hours) ? Math.round(hours * 10) / 10 : null;
}

function validate(value, { min, max, label } = {}) {
  if (value == null || !Number.isFinite(value)) return null;
  if (min != null && value < min) return null;
  if (max != null && value > max) return null;
  return value;
}

function normalizeRealData(raw) {
  if (!raw) return null;

  const pvPower      = validate(raw.pvPower, { min: 0, max: 100000 });
  const batteryPower = validate(raw.batteryPower, { min: -50000, max: 50000 });
  const batterySoc   = validate(raw.batterySoc, { min: 0, max: 100 });
  const gridPower    = validate(raw.gridPower, { min: -100000, max: 100000 });
  const loadPower    = validate(raw.loadPower, { min: 0, max: 100000 });
  const dailyEnergy  = validate(raw.dailyEnergy, { min: 0, max: 200 });
  const totalEnergy  = validate(raw.totalEnergy, { min: 0, max: 500000 });

  const batSplit  = deriveSplitPower(batteryPower);
  const gridSplit = deriveSplitPower(gridPower);

  return {
    pvPower,
    batteryPower,
    batterySoc,
    gridPower,
    loadPower,
    dailyEnergy,
    monthlyEnergy:  raw.monthlyEnergy,
    yearlyEnergy:   raw.yearlyEnergy,
    totalEnergy,
    co2Reduction:   raw.co2Reduction,
    profitToday:    raw.profitToday,
    profitTotal:    raw.profitTotal,
    batteryChargeEnergy:    raw.batteryChargeEnergy,
    batteryDischargeEnergy: raw.batteryDischargeEnergy,
    batteryChargePower:     batSplit.positive,
    batteryDischargePower:  batSplit.negative,
    gridImportPower:        gridSplit.positive,
    gridExportPower:        gridSplit.negative,
    batteryState:  deriveBatteryState(batteryPower),
    gridState:     deriveGridState(gridPower),
    selfPoweredPct: selfPoweredPct(loadPower, gridSplit.positive),
    powerBalance:   powerBalance(pvPower, batteryPower, gridPower),
    touMode:        raw.touMode,
  };
}

module.exports = {
  normalizeRealData,
  deriveBatteryState,
  deriveGridState,
  deriveSplitPower,
  selfPoweredPct,
  powerBalance,
  batteryRuntime,
  timeToFull,
  validate,
  DEADBAND_WATTS,
  DEFAULT_CAPACITY,
};
