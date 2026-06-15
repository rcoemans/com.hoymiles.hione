'use strict';

/**
 * HttpClient.js
 * Lightweight HTTP client using Node.js built-in https/http modules.
 * Replaces global `fetch` which may not be available in all Homey runtimes.
 */

const https = require('https');
const http  = require('http');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Perform an HTTP/HTTPS request.
 * @param {string} url - Full URL
 * @param {object} options
 * @param {string} options.method - HTTP method (GET, POST, etc.)
 * @param {object} options.headers - Request headers
 * @param {string|null} options.body - Request body (JSON string)
 * @param {number} options.timeoutMs - Request timeout in milliseconds
 * @returns {Promise<{ status: number, ok: boolean, body: string }>}
 */
function request(url, { method = 'POST', headers = {}, body = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;

    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers,
      timeout:  timeoutMs,
    };

    const req = transport.request(opts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode || 0,
          ok:     (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
          body:   responseBody,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${timeoutMs}ms`));
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (body) req.write(body);
    req.end();
  });
}

/**
 * POST JSON to a URL and parse the JSON response.
 * @param {string} url
 * @param {object} data - Object to JSON-serialize as request body
 * @param {object} headers - Additional request headers
 * @param {number} timeoutMs
 * @returns {Promise<object>} Parsed JSON response
 */
async function postJson(url, data, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const jsonBody = JSON.stringify(data);
  const mergedHeaders = {
    'Content-Type':  'application/json',
    'Accept':        'application/json',
    'Content-Length': Buffer.byteLength(jsonBody),
    ...headers,
  };

  const res = await request(url, {
    method:  'POST',
    headers: mergedHeaders,
    body:    jsonBody,
    timeoutMs,
  });

  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(res.body) };
  } catch (_) {
    return { status: res.status, ok: res.ok, data: null, rawBody: res.body };
  }
}

module.exports = { request, postJson };
