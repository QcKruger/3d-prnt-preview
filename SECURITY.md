# Security scope and verification

This project is a stateless, sandbox-only storefront. This document records implemented controls and their verification; it is not a certification, a PCI assessment, or an independent penetration test.

## Current boundaries

- No accounts, admin routes, database, uploaded models, persisted orders, or stored payment results.
- Customer checkout details are processed in memory and submitted to PayFast sandbox. Card details are handled by PayFast, not by this app.
- Sandbox-only destinations are enforced server-side, in the client handoff, and by CSP. The default merchant is PayFast's public test merchant; a private sandbox account can be configured with server environment settings.
- Payment notifications are deliberately absent. A redirect never marks an order paid or triggers fulfilment. Live payments are outside this implementation.
- GitHub Pages is a redirect destination, not the API host. It cannot run these server protections.

## Implemented controls

| Boundary             | Controls                                                                                                                                                                           | Verification                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Browser execution    | Fresh cryptographic script/style nonce for every HTML response; strict-dynamic; inline event handlers and style attributes blocked; no unsafe-inline/unsafe-eval                   | Browser CSP injection tests and HTML/header consistency tests |
| Browser capabilities | Frame denial, object/base denial, nosniff, no-referrer, restricted permissions; sandbox-only form action with configured return origins                                            | Header assertions and sandbox handoff tests                   |
| API input            | Server catalogue pricing; fixed redirect settings; customer length/type checks; quantity/product checks; JSON-only UTF-8; 16 KiB body limit; compressed bodies rejected            | Server validation and tampering tests                         |
| Request boundary     | Host allowlist; Origin/Fetch Metadata checks; no permissive CORS; malformed/oversized URL handling; restricted methods; generic unexpected errors                                  | Raw HTTP, origin, method, and host tests                      |
| Resource use         | Checkout 20/client/minute and 200/process/minute; all requests 300/client/minute and 5,000/process/minute; 32 concurrent sockets/client and 256/process; header/body/idle timeouts | Limiter, streaming/aborted-body, and connection-budget tests  |
| Static files         | Startup asset allowlist; no hidden files, source maps, arbitrary root JS, or server source; symbolic links rejected; no path traversal                                             | Production asset/private-file tests                           |
| Credentials          | Server-only settings, all three custom sandbox values required, payment-related VITE_ settings rejected, env files ignored by Git; no passphrase in checkout output                | Credential tests, build inspection, and secret guard          |
| Supply chain         | Lockfile-based npm ci; advisory audit; weekly Dependabot checks; SHA-pinned CI actions; read-only CI token with no persisted Git credential                                        | npm audit and CI configuration                                |

Transient rate counters use a process-random salt to hash client addresses and are bounded. Counters expire in memory and reset on restart. Active connection counts last only for socket lifetimes. Forwarded IP headers are not trusted; use gateway-level per-client throttling behind a reverse proxy rather than blindly accepting X-Forwarded-For.

## Run the security gate

Use Node.js 24 and installed Google Chrome locally:

```sh
npm ci
npm run security:check
```

This runs the secret guard, current dependency advisory audit, strict type/build checks, server security regressions, and desktop/mobile browser tests against the actual production Node server. No real payment is made by the automated suite. CI installs Chromium instead of using a local Chrome installation.

The Git hook invokes the secret guard on staged contents. Enable it in a new checkout with:

```sh
git config core.hooksPath .githooks
```

The guard blocks staged env files and common private-key/token/PayFast literal patterns without printing matched values. It is a targeted guard, not an exhaustive secret detector or a history scan. Enable GitHub secret scanning/push protection and require the security workflow in branch protection where available. Hooks can be bypassed, so CI is the independent check. No branch protection or remote repository settings are changed automatically.

## Environment and hosting requirements

- Keep development bound to loopback; do not expose Vite publicly. It serves development source and HMR by design, though sensitive server/config paths are explicitly denied.
- Use npm start for the built site. Public-interface binding requires APP_ORIGIN to be an explicit HTTPS origin. Configure your host/reverse proxy to enforce TLS and redirect HTTP to HTTPS; the Node listener itself is HTTP behind that proxy. HSTS is enabled automatically with APP_ORIGIN.
- Set secrets through a protected local .env or the host's secret manager. On Azure, prefer Key Vault references with managed identity. Do not store PayFast credentials in Cosmos DB, source, frontend environment variables, or browser storage.
- Do not publish credentials or customer data in logs, traces, issue reports, or screenshots. The app does not log request bodies or credentials.
- Configure edge throttling/connection limits for publicly accessible deployments. In-process controls are not a distributed DDoS service and are not shared between replicas.
- The server replaces the nonce placeholder in built HTML. Serving dist directly from a static host does not reproduce these headers, API routes, or nonce handling. Do not use Vite preview as an internet-facing production server.

## Before expanding scope

Adding persisted orders or live payments requires a separate review of access control, retention, verified ITN processing, amount/order matching, idempotency, and fulfilment transitions. This work intentionally does not introduce any of those features.

If a credential is exposed, rotate it in PayFast, update the server secret, restart the app, and remove it from repository history as needed. Do not paste the credential into a bug report.
