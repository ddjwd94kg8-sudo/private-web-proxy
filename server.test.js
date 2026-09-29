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

test('defaults to Vitality Games and accepts only explicitly configured HTTPS origins in production', () => {
  const defaults = configuration({ NODE_ENV: 'production' });
  assert.equal(defaults.target, 'https://vitalitygames.com');
  assert.deepEqual(defaults.allowedOrigins, ['https://vitalitygames.com']);
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'http://example.com' }), /HTTPS/);
  assert.throws(() => configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com/path' }), /origin/);
  assert.equal(configuration({ NODE_ENV: 'production', TARGET_URL: 'https://example.com' }).target, 'https://example.com');
  assert.deepEqual(configuration({
    NODE_ENV: 'production',
    PROXY_ALLOWED_ORIGINS: 'https://games.example, https://media.example/'
  }).allowedOrigins, ['https://vitalitygames.com', 'https://games.example', 'https://media.example']);
  assert.throws(() => configuration({ NODE_ENV: 'production', PROXY_ALLOWED_ORIGINS: 'https://example.com/path' }), /PROXY_ALLOWED_ORIGINS/);
  assert.throws(() => configuration({ NODE_ENV: 'production', PROXY_ALLOWED_ORIGINS: 'http://example.com' }), /PROXY_ALLOWED_ORIGINS/);
});

test('shows a launcher, proxies only approved origins for a browser session, and keeps health checks local', async () => {
  const makeUpstream = (name) => http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ name, method: request.method, url: request.url, body: Buffer.concat(chunks).toString(), key: request.headers['x-proxy-key'] || null }));
  });
  const firstUpstream = makeUpstream('first');
  const secondUpstream = makeUpstream('second');
  const firstUrl = await listen(firstUpstream);
  const secondUrl = await listen(secondUpstream);
  const proxy = http.createServer(createApp({ target: firstUrl, allowedOrigins: [firstUrl, secondUrl] }));
  const proxyUrl = await listen(proxy);
  try {
    assert.equal((await fetch(`${proxyUrl}/healthz`)).status, 200);
    const homepage = await fetch(proxyUrl);
    assert.equal(homepage.status, 200);
    assert.match(await homepage.text(), /Browse the web/);
    assert.match(await (await fetch(`${proxyUrl}/home`)).text(), /name="url"/);

    const selected = await fetch(`${proxyUrl}/proxy?url=${encodeURIComponent(`${secondUrl}/start?part=one`)}`, { redirect: 'manual' });
    assert.equal(selected.status, 303);
    assert.equal(selected.headers.get('location'), '/start?part=one');
    const proxyCookie = selected.headers.get('set-cookie').split(';', 1)[0];

    const selectedHome = await fetch(proxyUrl, { headers: { Cookie: proxyCookie } });
    assert.equal(selectedHome.status, 200);
    assert.deepEqual(await selectedHome.json(), { name: 'second', method: 'GET', url: '/', body: '', key: null });

    const response = await fetch(`${proxyUrl}/v1/item?part=two`, {
      method: 'POST',
      headers: { Cookie: proxyCookie, 'X-Proxy-Key': 'legacy-value', 'Content-Type': 'text/plain' },
      body: 'hello upstream'
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { name: 'second', method: 'POST', url: '/v1/item?part=two', body: 'hello upstream', key: null });

    const blocked = await fetch(`${proxyUrl}/proxy?url=${encodeURIComponent('https://not-approved.example/')}`, { redirect: 'manual' });
    assert.equal(blocked.status, 403);
    assert.match(await blocked.text(), /not enabled/);

    const invalid = await fetch(`${proxyUrl}/proxy?url=${encodeURIComponent('http://127.0.0.1:22/')}`, { redirect: 'manual' });
    assert.equal(invalid.status, 403);
  } finally {
    await close(proxy);
    await close(firstUpstream);
    await close(secondUpstream);
  }
});
