'use strict';

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

function configuration(environment = process.env) {
  const rawTarget = environment.TARGET_URL;
  const token = environment.PROXY_TOKEN;
  if (!rawTarget) throw new Error('TARGET_URL is required');
  if (!token || token.length < 24) throw new Error('PROXY_TOKEN must be at least 24 characters');

  let target;
  try {
    target = new URL(rawTarget);
  } catch {
    throw new Error('TARGET_URL must be an absolute URL');
  }
  if (target.username || target.password || target.search || target.hash || target.pathname !== '/') {
    throw new Error('TARGET_URL must be an origin without credentials, path, query, or fragment');
  }
  const localHttp = environment.NODE_ENV !== 'production' &&
    target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname);
  if (target.protocol !== 'https:' && !localHttp) {
    throw new Error('TARGET_URL must use HTTPS (local HTTP is allowed only outside production)');
  }

  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  return { target: target.origin, token, port };
}

function createApp({ target, token }) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => response.status(200).type('text').send('ok'));

  const expectedHash = createHash('sha256').update(token, 'utf8').digest();
  const cookieName = 'proxy_session';
  const sessionLifetime = 12 * 60 * 60;
  const matchesToken = (supplied) => timingSafeEqual(
    expectedHash, createHash('sha256').update(supplied, 'utf8').digest()
  );
  const signature = (expiry) => createHmac('sha256', token).update(`proxy-session:${expiry}`).digest('hex');
  const sessionCookie = () => {
    const expiry = Math.floor(Date.now() / 1000) + sessionLifetime;
    return `${cookieName}=${expiry}.${signature(expiry)}; Max-Age=${sessionLifetime}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  };
  const hasSession = (request) => {
    const value = request.headers.cookie?.split(';').map((part) => part.trim())
      .find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(value || '');
    if (!match || Number(match[1]) <= Math.floor(Date.now() / 1000)) return false;
    return timingSafeEqual(Buffer.from(match[2], 'hex'), Buffer.from(signature(match[1]), 'hex'));
  };

  // Exchange a one-time URL token for an HttpOnly cookie before contacting the upstream.
  // A form at /login also lets users avoid putting the token in browser history.
  app.get('/login', (_request, response) => response.type('html').send(`<!doctype html>
<html lang="en"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proxy sign in</title><form method="post" action="/login">
<label>Passkey <input name="token" type="password" required autocomplete="off"></label>
<button type="submit">Open site</button></form></html>`));
  app.post('/login', express.urlencoded({ extended: false, limit: '1kb' }), (request, response) => {
    response.set('Cache-Control', 'no-store');
    if (typeof request.body.token !== 'string' || !matchesToken(request.body.token)) {
      return response.status(401).type('text').send('Invalid passkey');
    }
    response.set('Set-Cookie', sessionCookie());
    return response.redirect(303, '/');
  });

  app.use((request, response, next) => {
    const url = new URL(request.originalUrl, 'http://localhost');
    if (request.method === 'GET' && url.searchParams.has('token')) {
      response.set('Cache-Control', 'no-store');
      response.set('Referrer-Policy', 'no-referrer');
      if (!matchesToken(url.searchParams.get('token') || '')) {
        return response.status(401).type('text').send('Invalid passkey');
      }
      response.set('Set-Cookie', sessionCookie());
      url.searchParams.delete('token');
      return response.redirect(303, `${url.pathname}${url.search}`);
    }
    const supplied = request.get('x-proxy-key') || '';
    if (!matchesToken(supplied) && !hasSession(request)) {
      return response.status(401).json({ error: 'Unauthorized' });
    }
    // The proxy key authenticates this hop only. Do not send it to the target.
    delete request.headers['x-proxy-key'];
    // Do not leak the proxy's authentication cookie to the upstream.
    if (request.headers.cookie) {
      const otherCookies = request.headers.cookie.split(';').map((part) => part.trim())
        .filter((part) => part && !part.startsWith(`${cookieName}=`));
      if (otherCookies.length) request.headers.cookie = otherCookies.join('; ');
      else delete request.headers.cookie;
    }
    next();
  });

  app.use(createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    on: {
      error(error, _request, response) {
        console.error('Upstream proxy error:', error.message);
        if (response.headersSent) return response.destroy(error);
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'Bad Gateway' }));
      }
    }
  }));
  return app;
}

if (require.main === module) {
  try {
    const config = configuration();
    createApp(config).listen(config.port, '0.0.0.0', () => {
      console.log(`Proxy listening on ${config.port} for ${config.target}`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { configuration, createApp };
