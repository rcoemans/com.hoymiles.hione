'use strict';

const https = require('https');
const http  = require('http');

const DEFAULT_TIMEOUT_MS = 15000;

const MAX_REDIRECTS = 5;

function request(url, { method = 'GET', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS, _redirectCount = 0 } = {}) {
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
      // Follow redirects (301, 302, 303, 307, 308)
      if (res.statusCode >= 301 && res.statusCode <= 308 && res.headers.location && _redirectCount < MAX_REDIRECTS) {
        const redirectUrl = new URL(res.headers.location, url).href;
        // 307/308 preserve method+body; 301/302/303 switch to GET
        const preserveMethod = res.statusCode === 307 || res.statusCode === 308;
        res.resume(); // discard response body
        resolve(request(redirectUrl, {
          method:    preserveMethod ? method : 'GET',
          headers,
          body:      preserveMethod ? body : null,
          timeoutMs,
          _redirectCount: _redirectCount + 1,
        }));
        return;
      }

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
