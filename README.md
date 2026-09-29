# private-web-proxy

An Express reverse proxy with a simple URL launcher. The public `/` page lets visitors select an approved site; `/healthz` stays local for hosting health checks. Destinations are restricted to an explicit HTTPS origin allowlist, so the service cannot be used as an unrestricted proxy to arbitrary hosts or private network addresses.

## Configuration

Set these environment variables on the host:

| Variable | Purpose |
| --- | --- |
| `TARGET_URL` | Default HTTPS origin. Defaults to `https://vitalitygames.com`. It is always included in the allowed list. No path or query. Local HTTP is accepted only outside production for development. |
| `PROXY_ALLOWED_ORIGINS` | Optional comma-separated list of additional HTTPS origins the Surf form may open, such as `https://games.example,https://media.example`. Each entry must be an origin with no path, query, or fragment. Add only domains you own or are authorized to proxy. |
| `PORT` | Internal listening port; defaults to `3000` locally. Render sets this automatically. |

## Local use

```sh
npm ci
TARGET_URL=https://vitalitygames.com npm start
curl http://localhost:3000/healthz
npm test
```

## Deploy on Render

1. Create a **Web Service** from this repository, using Node.js.
2. Set build command `npm ci`, start command `npm start`, and health check path `/healthz`.
3. Optionally set `TARGET_URL` in Render; if omitted, the default approved site is `https://vitalitygames.com`. To allow more sites, set `PROXY_ALLOWED_ORIGINS` to a comma-separated list of exact HTTPS origins. A visitor can then choose among those origins without changing the target for each page.
4. Visit `https://YOUR-SERVICE.onrender.com/` to open the launcher. After selecting a site, a browser cookie keeps requests on that approved origin for the session. `/home` returns to the launcher. The public HTTPS URL uses port **443**. Render manages the certificate, redirects HTTP to HTTPS, terminates TLS at its edge, and forwards to the app on the internal `PORT`. Node should not bind directly to port 443 on Render.

Use HTTPS origins for encryption from Render to upstream sites. Render's internal edge-to-app hop is HTTP; this is not end-to-end TLS to the Node process. The proxy preserves relative navigation and rewrites cookie domains, but does not rewrite absolute links in HTML or browser JavaScript; sites that depend on those may leave the proxy or fail to load. Upstream sites may still present bot checks or other access restrictions. Host and upstream access logs may contain metadata, so the repository name does not imply anonymity.
