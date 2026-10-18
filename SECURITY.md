# Security scope and verification

This project is a sandbox-payment storefront with public Cosmos content and private guest return intake. This document records implemented controls and their verification; it is not a certification, a PCI assessment, or an independent penetration test.

## Current boundaries

- No accounts, admin routes, uploaded models or live payments. The public read-only `/api/content` endpoint returns validated catalogue/site content from Cosmos. Private sandbox checkouts, validated transaction/event records, return cases and hashed status grants are stored in Cosmos. Browser redirects and guest-supplied fields never establish verified payment or authorize refunds.
- Checkout stores contact details, server-priced items and the selected delivery address privately before PayFast handoff. Collection discards supplied delivery addresses. Card details are handled by PayFast, not by this app. Rates and supported provinces are server-controlled and the signed total includes delivery.
- Sandbox-only destinations are enforced server-side, in the client handoff, and by CSP. The default merchant is PayFast's public test merchant; a private sandbox account can be configured with server environment settings.
- PayFast sandbox notifications validate signature, merchant, source, stored integer-cent amount and a fixed HTTPS server confirmation before persisting trusted transaction data. Only that callback can establish `verified-sandbox`; no real fulfilment is triggered.
- Return, cancel and notification URLs use the Azure App Service. GitHub Pages cannot run these server protections and is no longer the payment return destination.

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

## Guest return controls

Guest returns use strict server-side validation, explicit document projection, fixed server-controlled status/type/identity fields, consent confirmation and a separate submission limiter (5/address/10 minutes, 50/process/10 minutes). Contact details, explanations and order references are never included in the public receipt or operational logs. Only a successful Cosmos create, or a matching idempotent retry, issues a receipt. A conflicting UUID cannot overwrite a case. There is no public return read/list/update endpoint. The existing public-content query excludes `ReturnRequest`, and its validator also rejects that type. Deployed failures remain 503 without local storage fallback; local memory simulation is explicitly identified and bounded.

There are no automatic return/refund approvals, uploaded evidence or staff notifications. Authorized staff review private Cosmos cases manually until an authenticated administration flow is designed. Customer accounts, verified order linkage, staff authorization and retention/deletion rules require separate implementation; no one may claim a case by merely knowing an email address. See the guest returns section in README.md for operation and current limitations.

## Private guest tracking

Saved checkout/return responses may issue a read-only status link for that record. Tokens are 256-bit cryptographically random bearer credentials; only SHA-256 hashes are stored. Links expire after seven days by default (server-configurable 1–720 hours). Server expiry and grant deletion enforce access regardless of Cosmos TTL cleanup. There is no reference/email search, token renewal or staff write endpoint. Losing the link requires support; email verification/recovery is deferred.

Tokens use URL fragments so normal HTTP access logs/referrers do not contain them. The frontend removes the token from the current history entry and sends it only in the JSON body of `POST /api/tracking/view`. No cookies, localStorage or sessionStorage are used for tracking. Host/origin, JSON/body/time limits and an additional 30/address/minute, 500/process/minute limiter apply. Invalid/expired tokens receive the same 404. Views explicitly project a status, reference, timestamps and fulfilment instructions; contact details, delivery addresses, free-text return explanations, private notes, signatures and stored hashes are excluded. Links still confer access to limited status, so users are told to keep them private.

Production stores private records only through the system identity in Cosmos and fails closed on outages. Local simulation is bounded to 3,000 records with 24-hour expiry and clears on restart. Snapshots use create-only idempotency; a duplicate ID with different details cannot overwrite a record. Separate partitions mean case/order/grant creation is not atomic: checkout can retry the same payload/ID, and a saved return may return a reference without a link if grant creation fails. Staff inspect/update fulfilment through authorized Cosmos tooling only. Guest tracking exposes an explicit validated sandbox payment state without returning transaction bodies or financial credentials.

## Payment notification boundary

`POST /api/payment/notify` is the only machine-to-machine exception to browser Origin/Fetch Metadata checks. It still enforces Host, method, form content type, UTF-8/body limits, compressed-body rejection and dedicated rate limiting. All received fields participate in ordered ITN signature verification (including empty/whitespace values); duplicates or unsigned trailing fields are rejected. Timing-safe digest comparison, merchant binding and exact stored-order amount checks precede trusted writes. Validation posts only to the fixed sandbox HTTPS URL, denies redirects and bounds time/response size. There is no live host switch or environment bypass of these checks.

Source validation uses PayFast's documented IPv4 ranges. Direct/local servers use the socket peer and reject forged Referer/forwarding claims. Only a production App Service behind IISNode's named pipe trusts the rightmost entry from one Azure platform forwarding hop; an attacker-supplied prefix cannot choose the observed source. Adding another reverse proxy requires a separately reviewed trust configuration. The source ranges must be maintained against PayFast's official documentation.

Transaction IDs bind a provider payment ID to one sandbox merchant/order/amount. Minimal projected financial records and immutable hashed notification events exclude raw bodies, signatures, passphrases and duplicate payer contact data. ETag conditional updates avoid lost concurrent writes. Replayed/stale failures cannot downgrade COMPLETE, and retries repair partial persistence before acknowledgement. Database/provider failures receive 503 rather than an early success. Controlled stage/status logs are stored privately outside wwwroot in `payfast.log`; no public transaction listing or guest write route exists. Public demo credentials are shared test credentials and must never protect live payments; custom sandbox credentials remain server-only.

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

- Cosmos access is server-only and keyless. Production uses an explicit system-assigned ManagedIdentityCredential with no credential-chain fallback. A fixed, bounded query projects only public fields from five approved entity types; unknown fields/types and malformed records are not returned. Checkout derives prices from the same current database catalogue, rejecting missing products and returning 503 on an outage. Content is not retained as a stale fallback after a failed refresh. Only explicit local development can load seed data, and local seed/loader files are excluded from deployment. The listener remains available on Cosmos failure, with controlled server logging. Future private account endpoints still require ownership authorization; the app identity alone does not provide that boundary.

- Keep development bound to loopback; do not expose Vite publicly. It serves development source and HMR by design, though sensitive server/config paths are explicitly denied.
- Use npm start for the built site. Public-interface binding requires APP_ORIGIN to be an explicit HTTPS origin. Configure your host/reverse proxy to enforce TLS and redirect HTTP to HTTPS; the Node listener itself is HTTP behind that proxy. HSTS is enabled automatically with APP_ORIGIN.
- Set secrets through a protected local .env or the host's secret manager. On Azure, prefer Key Vault references with managed identity. Do not store PayFast credentials in Cosmos DB, source, frontend environment variables, or browser storage.
- Do not publish credentials or customer data in logs, traces, issue reports, or screenshots. The app does not log request bodies or credentials.
- Configure edge throttling/connection limits for publicly accessible deployments. In-process controls are not a distributed DDoS service and are not shared between replicas.
- The server replaces the nonce placeholder in built HTML. Serving dist directly from a static host does not reproduce these headers, API routes, or nonce handling. Do not use Vite preview as an internet-facing production server.

## Before expanding scope

Live payments and fulfilment require separate credential/host configuration, staff authorization, operational reconciliation and guarded shipment/refund transitions. Current validation and records are sandbox-only; there is no automated shipment or refund integration.

If a credential is exposed, rotate it in PayFast, update the server secret, restart the app, and remove it from repository history as needed. Do not paste the credential into a bug report.
