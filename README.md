# private-web-proxy

An Express reverse proxy for one fixed upstream, using `http-proxy-middleware`. It forwards the request method, path, query, headers and body. Requests to the proxy require an `X-Proxy-Key` header; `/healthz` is public for hosting health checks. The key is removed before forwarding.

## Configuration

Set these environment variables on the host (do not commit the real values):

| Variable | Purpose |
| --- | --- |
| `TARGET_URL` | HTTPS origin to proxy, for example `https://api.example.com`. No path or query. Local HTTP is accepted only outside production for development. |
| `PROXY_TOKEN` | Random secret of at least 24 characters, supplied by clients in `X-Proxy-Key`. Generate one with `openssl rand -hex 32`. |
| `PORT` | Internal listening port; defaults to `3000` locally. Render sets this automatically. |

## Local use

```sh
npm ci
TARGET_URL=https://example.com PROXY_TOKEN=replace-with-your-random-secret npm start
curl -H 'X-Proxy-Key: replace-with-your-random-secret' http://localhost:3000/some/path?x=1
npm test
```

## Deploy on Render

1. Create a **Web Service** from this repository, using Node.js.
2. Set build command `npm ci`, start command `npm start`, and health check path `/healthz`.
3. Set `TARGET_URL` and `PROXY_TOKEN` as environment variables in Render. Use an HTTPS upstream. Do not put secrets in the public repository.
4. Call `https://YOUR-SERVICE.onrender.com/path` with the `X-Proxy-Key` header. This public HTTPS URL uses port **443**. Render manages the certificate, redirects HTTP to HTTPS, terminates TLS at its edge, and forwards to the app on the internal `PORT`. Node should not bind directly to port 443 on Render.

Use an HTTPS `TARGET_URL` for encryption from Render to the upstream as well. Render's internal edge-to-app hop is HTTP; this is not end-to-end TLS to the Node process. The proxy does not rewrite absolute links in HTML, redirects, cookies or browser JavaScript. It is intended for API clients that can send a custom header, not as a transparent browser proxy. Host and upstream access logs may still contain metadata, so the repository name does not imply anonymity.
