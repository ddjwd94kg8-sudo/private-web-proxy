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

  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535');
  return { target: target.origin, port };
}

function createApp({ target }) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => response.status(200).type('text').send('ok'));

  app.use((request, _response, next) => {
    // Ignore legacy proxy credentials instead of forwarding them upstream.
    delete request.headers['x-proxy-key'];
    next();
  });

  // Mount the fixed upstream at the site root so / renders its homepage by default.
  app.use('/', createProxyMiddleware({
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
