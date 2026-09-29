'use strict';

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

function configuration(environment = process.env) {
  const rawTarget = environment.TARGET_URL || 'https://vitalitygames.com';

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

  const allowedOrigins = new Set([target.origin]);
  for (const value of (environment.PROXY_ALLOWED_ORIGINS || '').split(',')) {
    const candidate = value.trim();
    if (!candidate) continue;
    let origin;
    try {
      const parsed = new URL(candidate);
      if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
        throw new Error();
      }
      const localHttpOrigin = environment.NODE_ENV !== 'production' && parsed.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (parsed.protocol !== 'https:' && !localHttpOrigin) throw new Error();
      origin = parsed.origin;
    } catch {
      throw new Error('PROXY_ALLOWED_ORIGINS must be a comma-separated list of HTTPS origins');
    }
    allowedOrigins.add(origin);
  }

  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  return { target: target.origin, allowedOrigins: [...allowedOrigins], port };
}

const landingPage = `<!doctype html>
<html lang="en"
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#111318">
  <title>Private Web Proxy</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; color: #f4f5f7; background: radial-gradient(ellipse at 50% 35%, #202431 0, #111318 55%, #0b0c0f 100%); }
    main { width: min(100%, 680px); text-align: center; }
    .mark { width: 56px; height: 56px; display: grid; place-items: center; margin: 0 auto 22px; border: 1px solid #3c4252; border-radius: 18px; color: #c4a7ff; background: #1c1b27; font-size: 26px; }
    h1 { margin: 0; font-size: clamp(30px, 7vw, 44px); letter-spacing: -1.5px; }
    .intro { margin: 12px 0 30px; color: #a7abba; font-size: 16px; line-height: 1.6; }
    form { display: flex; gap: 10px; padding: 8px; border: 1px solid #414552; border-radius: 17px; background: #191b21; box-shadow: 0 18px 60px #0006; }
    input { min-width: 0; flex: 1; border: 0; outline: 0; padding: 14px 12px; color: #f7f7fa; background: transparent; font: inherit; font-size: 16px; }
    input::placeholder { color: #858a98; }
    button { border: 0; border-radius: 11px; padding: 0 24px; color: #17131f; background: #c4a7ff; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #d2bdff; }
    .note { margin: 16px 6px 0; color: #838897; font-size: 13px; line-height: 1.6; }
    @media (max-width: 480px) { body { padding: 18px; } form { gap: 4px; padding: 6px; } input { padding: 12px 8px; font-size: 14px; } button { padding: 0 16px; } }
  </style>
</head>
<body>
  <main>
    <div class="mark" aria-hidden="true">↗</div>
    <h1>Browse the web</h1>
    <p class="intro">Enter a web address to open it through this proxy.</p>
    <form action="/proxy" method="get" id="surf-form">
      <input type="text" inputmode="url" name="url" id="url" placeholder="https://example.com" aria-label="Website address" autocomplete="url" required>
      <button type="submit">Surf</button>
    </form>
    <p class="note">Only HTTPS sites approved by the proxy owner can be opened. Some sites may block proxy traffic or limit features.</p>
  </main>
  <script>
    document.getElementById('surf-form').addEventListener('submit', function (event) {
      const field = document.getElementById('url');
      const value = field.value.trim();
      try {
const address = value.includes('://') ? value : 'https://' + value;
        const parsed = new URL(address);
        if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) throw new Error();
        field.value = parsed.href;
      } catch {
        event.preventDefault();
        field.setCustomValidity('Enter a valid HTTPS web address.');
        field.reportValidity();
        field.addEventListener('input', function clearError() { field.setCustomValidity(''); field.removeEventListener('input', clearError); });
      }
    });
  </script>
</body>
</html>`;

function readProxyOrigin(request, allowedOrigins) {
  const cookies = request.headers.cookie || '';
  const match = cookies.match(/(?:^|;\s*)proxy_origin=([^;]*)/);
  if (!match) return null;
  try {
    const origin = decodeURIComponent(match[1]);
    return allowedOrigins.has(origin) ? origin : null;
  } catch {
    return null;
  }
}

function createApp({ target, allowedOrigins = [target] }) {
  const app = express();
  app.disable('x-powered-by');
  const allowed = new Set(allowedOrigins);
  const defaultOrigin = new URL(target).origin;

  app.get('/healthz', (_request, response) => response.status(200).type('text').send('ok'));

  app.use((request, _response, next) => {
    // Ignore legacy proxy credentials instead of forwarding them upstream.
    delete request.headers['x-proxy-key'];
    next();
  });

  function showLandingPage(_request, response) {
    response.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
    response.type('html').send(landingPage);
  }

  // The launcher is shown on the first visit. After selecting an approved origin,
  // a per-browser cookie keeps that origin active for relative links and assets.
  app.get('/', (request, response, next) => {
    request.proxyOrigin = readProxyOrigin(request, allowed);
    if (request.proxyOrigin) return next();
    showLandingPage(request, response);
  });
  app.get('/home', showLandingPage);

  app.get('/proxy', (request, response) => {
    const rawDestination = new URL(request.originalUrl, 'http://proxy.local').searchParams.get('url');
    if (!rawDestination) {
      return response.status(400).type('text').send('Enter a website address, then try again.');
    }

    let destination;
    try {
      const candidate = /^[a-z][a-z0-9+.-]*:/i.test(rawDestination) ? rawDestination : `https://${rawDestination}`;
      destination = new URL(candidate);
    } catch {
      return response.status(400).type('text').send('Enter a valid website address.');
    }
    const localHttpOrigin = process.env.NODE_ENV !== 'production' && destination.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(destination.hostname);
    if ((destination.protocol !== 'https:' && !localHttpOrigin) || destination.username || destination.password || !allowed.has(destination.origin)) {
      return response.status(403).type('text').send('This HTTPS site is not enabled for this proxy. Ask the proxy owner to add its origin to the approved list.');
    }

    response.cookie('proxy_origin', destination.origin, {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      path: '/',
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });
    response.redirect(303, `${destination.pathname}${destination.search}${destination.hash}`);
  });

  // Requests stay on the selected allowlisted origin for this browser session.
  app.use('/', createProxyMiddleware({
    target,
    router(request) {
      return request.proxyOrigin || readProxyOrigin(request, allowed) || defaultOrigin;
    },
    changeOrigin: true,
    secure: true,
    cookieDomainRewrite: '',
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
