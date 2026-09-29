# private-web-proxy

An Express reverse proxy for one fixed upstream, using `http-proxy-middleware`. It forwards the request method, path, query, headers and body. The proxy is public and does not require a passkey; visiting `/` renders the upstream homepage. Its upstream is fixed by `TARGET_URL`, which defaults to `https://vitalitygames.com`. `/healthz` is handled locally for hosting health checks.

## Configuration

Set these environment variables on the host:

| Variable | Purpose |
| --- | --- |
| `TARGET_URL` | HTTPS origin to proxy. Defaults to `https://vitalitygames.com`. No path or query. Local HTTP is accepted only outside production for development. |
| `PORT` | Internal listening port; defaults to `3000` locally. Render sets this automatically. |

## Local use

```sh
npm ci
TARGET_URL=https://vitalitygames.com npm start
curl http://localhost:3000/
npm test
```

## Deploy on Render

1. Create a **Web Service** from this repository, using Node.js.
2. Set build command `npm ci`, start command `npm start`, and health check path `/healthz`.
3. Optionally set `TARGET_URL` in Render; if omitted, the service proxies `https://vitalitygames.com`.
4. Visit `https://YOUR-SERVICE.onrender.com/` to load the upstream homepage. All proxy routes are publicly accessible. The public HTTPS URL uses port **443**. Render manages the certificate, redirects HTTP to HTTPS, terminates TLS at its edge, and forwards to the app on the internal `PORT`. Node should not bind directly to port 443 on Render.

Use an HTTPS `TARGET_URL` for encryption from Render to the upstream as well. Render's internal edge-to-app hop is HTTP; this is not end-to-end TLS to the Node process. The proxy does not rewrite absolute links in HTML, redirects, cookies or browser JavaScript, so browser sites that rely on those may leave the proxy's domain or fail to load. The target may still present its own bot checks or access restrictions. Host and upstream access logs may still contain metadata, so the repository name does not imply anonymity.
