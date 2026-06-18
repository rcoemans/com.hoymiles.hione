'use strict';

const https = require('https');
const http  = require('http');

const DEFAULT_TIMEOUT_MS = 15000;

function request(url, { method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const client  = parsed.protocol === 'https:' ? https : http;
    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers,
    };

    const req = client.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve({
          status: res.statusCode,
          ok:     res.statusCode >= 200 && res.statusCode < 300,
          body:   raw,
        });
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms`));
    });

    if (body) req.write(body);
    req.end();
  });
}

async function postJson(url, data, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const payload = JSON.stringify(data);
  const res = await request(url, {
    method:    'POST',
    headers:   { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...headers },
    body:      payload,
    timeoutMs,
  });

  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch (_) { /* not JSON */ }
  return { status: res.status, ok: res.ok, data: parsed, body: res.body };
}

async function getJson(url, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const res = await request(url, { method: 'GET', headers, timeoutMs });
  let parsed = null;
  try { parsed = JSON.parse(res.body); } catch (_) { /* not JSON */ }
  return { status: res.status, ok: res.ok, data: parsed, body: res.body };
}

module.exports = { request, postJson, getJson };
