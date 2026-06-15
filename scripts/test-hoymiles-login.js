#!/usr/bin/env node
'use strict';

/**
 * Standalone Hoymiles Cloud API login test script.
 *
 * Usage:
 *   node scripts/test-hoymiles-login.js --username "you@example.com" --password "yourpass" [--mode auto]
 *
 * Modes: auto, web_v3, installer_v3, legacy_v0
 *
 * This script tests authentication, fetches user info, lists stations,
 * and optionally fetches real-time data for the first station.
 */

const HoymilesApi = require('../lib/HoymilesApi');

const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf('--' + name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

const username = getArg('username') || process.env.HOYMILES_USERNAME;
const password = getArg('password') || process.env.HOYMILES_PASSWORD;
const mode     = getArg('mode') || 'auto';

if (!username || !password) {
  console.error('Usage: node scripts/test-hoymiles-login.js --username "email" --password "pass" [--mode auto]');
  console.error('  Or set HOYMILES_USERNAME and HOYMILES_PASSWORD environment variables.');
  process.exit(1);
}

const log   = (...a) => console.log('[LOG]', ...a);
const error = (...a) => console.error('[ERR]', ...a);

async function main() {
  const api = new HoymilesApi({ log, error });

  // Step 1: Authenticate
  console.log('\n═══ Step 1: Authenticate ═══');
  console.log(`Username: ${username}`);
  console.log(`Mode:     ${mode}`);
  console.log();

  try {
    const result = await api.authenticate(username, password, { mode });
    console.log('✓ Authentication succeeded');
    console.log('  Mode:    ', result.mode);
    console.log('  Profile: ', result.profile);
    console.log('  Variant: ', result.variant || '(none)');
    console.log('  Token:   ', result.token ? result.token.substring(0, 20) + '...' : '(none)');
  } catch (err) {
    console.error('✗ Authentication FAILED:', err.message);
    if (err.attempts) {
      console.error('\nAuth attempts:');
      err.attempts.forEach((a, i) => {
        console.error(`  ${i + 1}. ${a.mode}[${a.profile}]${a.variant ? '(' + a.variant + ')' : ''} → ${a.success ? 'OK' : a.status + ': ' + a.message}`);
      });
    }
    process.exit(1);
  }

  // Step 2: Get current user
  console.log('\n═══ Step 2: Get current user ═══');
  try {
    const userResp = await api.getCurrentUser();
    const userData = userResp?.data || {};
    console.log('✓ User info retrieved');
    console.log('  User ID: ', userData.id || '(unknown)');
    console.log('  Username:', userData.user_name || userData.userName || '(unknown)');
  } catch (err) {
    console.error('✗ user/me failed:', err.message);
  }

  // Step 3: List stations
  console.log('\n═══ Step 3: List stations ═══');
  let stations = [];
  try {
    stations = await api.getStations();
    console.log(`✓ Found ${stations.length} station(s)`);
    stations.forEach((s, i) => {
      console.log(`  ${i + 1}. [${s.id}] ${s.name} (SN: ${s.sn || '-'})`);
    });
  } catch (err) {
    console.error('✗ Station list failed:', err.message);
    process.exit(1);
  }

  // Step 4: Fetch real-time data for first station
  if (stations.length > 0) {
    const sid = stations[0].id;
    console.log(`\n═══ Step 4: Real-time data for station ${sid} ═══`);
    try {
      const data = await api.getRealData(sid);
      console.log('✓ Real-time data:');
      console.log('  PV Power:      ', data.pvPower, 'W');
      console.log('  Battery Power: ', data.batteryPower, 'W');
      console.log('  Battery SoC:   ', data.batterySoc, '%');
      console.log('  Grid Power:    ', data.gridPower, 'W');
      console.log('  Load Power:    ', data.loadPower, 'W');
      console.log('  Battery Mode:  ', data.batteryMode);
    } catch (err) {
      console.error('✗ Real-time data failed:', err.message);
    }

    // Step 5: Fetch energy data
    console.log(`\n═══ Step 5: Energy data for station ${sid} ═══`);
    try {
      const energy = await api.getEnergyData(sid);
      console.log('✓ Energy data:');
      console.log('  Daily Energy:  ', energy.dailyEnergy, 'kWh');
      console.log('  Total Energy:  ', energy.totalEnergy, 'kWh');
    } catch (err) {
      console.error('✗ Energy data failed:', err.message);
    }
  }

  console.log('\n═══ Done ═══');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
