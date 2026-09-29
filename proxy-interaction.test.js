'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');
const { createApp } = require('./server');

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return 'http://127.0.0.1:' + server.address().port;
}

async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('search forms, scripts, redirects, and cookies stay on the selected origin', async () => {
  let upstreamUrl;
  const upstream = http.createServer(async (request, response) => {
    if (request.url === '/script.js') {
      response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      response.end('window.location.href = "' + upstreamUrl + '/results";' +
        'const endpoint = "' + upstreamUrl.replaceAll('/', '\\/') + '\\/api";' +
        'const next = "//' + new URL(upstreamUrl).host + '/go";');
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, {
        Location: upstreamUrl + '/results',
        'Set-Cookie': 'session=abc; Domain=127.0.0.1; Path=/results; HttpOnly'
      });
      response.end();
      return;
    }
    if (request.method === 'POST') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        method: request.method,
        url: request.url,
        body: Buffer.concat(chunks).toString(),
        origin: request.headers.origin,
        referer: request.headers.referer,
        cookie: request.headers.cookie
      }));
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy', 'form-action ' + upstreamUrl + "; script-src 'self' " + upstreamUrl);
    response.setHeader('Set-Cookie', 'session=abc; Domain=127.0.0.1; Path=/results; HttpOnly');
    response.end('<form action="' + upstreamUrl + '/" method="get"><input name="q"></form>' +
      '<script src="' + upstreamUrl + '/script.js"></script>' +
      '<script>window.location.href = "' + upstreamUrl + '/results";</script>' +
      '<form action="//' + new URL(upstreamUrl).host + '/search" method="post"></form>' +
      '<a href="' + upstreamUrl.replace('http:', 'https:') + '/different">Other protocol</a>' +
      '<a href="https://not-approved.example/">External</a><p>' + request.url + '</p>');
  });
  upstreamUrl = await listen(upstream);
  const proxy = http.createServer(createApp({ target: upstreamUrl, allowedOrigins: [upstreamUrl] }));
  const proxyUrl = await listen(proxy);
  try {
    const selected = await fetch(proxyUrl + '/proxy?url=' + encodeURIComponent(upstreamUrl), { redirect: 'manual' });
    assert.equal(selected.status, 303);
    const proxyCookie = selected.headers.get('set-cookie').split(';', 1)[0];

    const homepage = await fetch(proxyUrl, { headers: { Cookie: proxyCookie, Accept: 'text/html' } });
    const html = await homepage.text();
    assert.equal(homepage.status, 200);
    assert.ok(html.includes('action="' + proxyUrl + '/"'));
    assert.ok(html.includes('src="' + proxyUrl + '/script.js"'));
    assert.ok(html.includes('window.location.href = "' + proxyUrl + '/results"'));
    assert.ok(html.includes('action="//' + new URL(proxyUrl).host + '/search"'));
    assert.ok(html.includes(upstreamUrl.replace('http:', 'https:') + '/different'));
    assert.ok(html.includes('https://not-approved.example/'));
    assert.ok(!html.includes(upstreamUrl));
    assert.equal(homepage.headers.get('content-security-policy'), 'form-action ' + proxyUrl + "; script-src 'self' " + proxyUrl);
    assert.match(homepage.headers.get('set-cookie'), /session=abc; HttpOnly; Path=\//);
    assert.doesNotMatch(homepage.headers.get('set-cookie'), /Domain=/i);

    const getSearch = await fetch(proxyUrl + '/?q=retro+games', { headers: { Cookie: proxyCookie, Accept: 'text/html' } });
    assert.ok((await getSearch.text()).includes('<p>/?q=retro+games</p>'));

    const postSearch = await fetch(proxyUrl, {
      method: 'POST',
      headers: {
        Cookie: proxyCookie + '; session=abc',
        Origin: proxyUrl,
        Referer: proxyUrl + '/?q=old',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'q=retro+games&ia=web'
    });
    assert.deepEqual(await postSearch.json(), {
      method: 'POST',
      url: '/',
      body: 'q=retro+games&ia=web',
      origin: upstreamUrl,
      referer: upstreamUrl + '/?q=old',
      cookie: 'session=abc'
    });

    const script = await fetch(proxyUrl + '/script.js', {
      headers: { Cookie: proxyCookie, 'Sec-Fetch-Dest': 'script' }
    });
    assert.equal(await script.text(), 'window.location.href = "' + proxyUrl + '/results";' +
      'const endpoint = "' + proxyUrl.replaceAll('/', '\\/') + '\\/api";' +
      'const next = "//' + new URL(proxyUrl).host + '/go";');

    const redirected = await fetch(proxyUrl + '/redirect', { headers: { Cookie: proxyCookie }, redirect: 'manual' });
    assert.equal(redirected.status, 302);
    assert.equal(redirected.headers.get('location'), proxyUrl + '/results');
    assert.match(redirected.headers.get('set-cookie'), /session=abc; Path=\/; HttpOnly/);
    assert.doesNotMatch(redirected.headers.get('set-cookie'), /Domain=/i);
  } finally {
    await close(proxy);
    await close(upstream);
  }
});
