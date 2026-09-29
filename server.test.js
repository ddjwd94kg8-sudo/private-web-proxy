'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { configuration, createApp } = require('./server');

const token = 'a-long-random-test-token-with-32-bytes';

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('requires a fixed HTTPS target and a meaningful key in production', () => {
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'http://example.com', PROXY_TOKEN: token }), /HTTPS/);
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com/path', PROXY_TOKEN: token }), /origin/);
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com' }), /PROXY_TOKEN/);
  assert.equal(configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com', PROXY_TOKEN: token }).target, 'https://example.com');
});

test('rejects unknown clients, then streams method, path, query and body to the fixed upstream', async () => {
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString(), key: request.headers['x-proxy-key'] || null }));
  });
  const upstreamUrl = await listen(upstream);
  const proxy = http.createServer(createApp({ target: upstreamUrl, token }));
  const proxyUrl = await listen(proxy);
  try {
    assert.equal((await fetch(`${proxyUrl}/healthz`)).status, 200);
    assert.equal((await fetch(`${proxyUrl}/v1/item`)).status, 401);
    assert.equal((await fetch(`${proxyUrl}/v1/item`, { headers: { 'X-Proxy-Key': 'wrong' } })).status, 401);
    const response = await fetch(`${proxyUrl}/v1/item?part=one`, {
      method: 'POST',
      headers: { 'X-Proxy-Key': token, 'Content-Type': 'text/plain' },
      body: 'hello upstream'
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { method: 'POST', url: '/v1/item?part=one', body: 'hello upstream', key: null });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
