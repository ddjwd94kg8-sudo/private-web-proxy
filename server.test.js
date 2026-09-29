'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { configuration, createApp } = require('./server');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('defaults to Vitality Games and requires a fixed HTTPS target in production', () => {
  assert.equal(configuration({ NODE_ENV: 'production' }).target, 'https://vitalitygames.com');
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com/path' }), /origin/);
  assert.equal(configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com' }).target, 'https://example.com');
});

test('proxies the homepage and routes without authentication, stripping legacy proxy keys', async () => {
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString(), key: request.headers['x-proxy-key'] || null }));
  });
  const upstreamUrl = await listen(upstream);
  const proxy = http.createServer(createApp({ target: upstreamUrl }));
  const proxyUrl = await listen(proxy);
  try {
    assert.equal((await fetch(`${proxyUrl}/healthz`)).status, 200);
    const homepage = await fetch(proxyUrl);
    assert.equal(homepage.status, 200);
    assert.deepEqual(await homepage.json(), { method: 'GET', url: '/', body: '', key: null });

    const publicRoute = await fetch(`${proxyUrl}/v1/item`);
    assert.equal(publicRoute.status, 200);
    assert.deepEqual(await publicRoute.json(), { method: 'GET', url: '/v1/item', body: '', key: null });

    const response = await fetch(`${proxyUrl}/v1/item?part=one`, {
      method: 'POST',
      headers: { 'X-Proxy-Key': 'legacy-value', 'Content-Type': 'text/plain' },
      body: 'hello upstream'
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { method: 'POST', url: '/v1/item?part=one', body: 'hello upstream', key: null });
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
