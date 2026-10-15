# 3D PRNT

React 19 and TypeScript website built with Vite, with a Node.js API for PayFast sandbox checkout.

## Run locally

Use Node.js 24 LTS and npm.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite. The development server runs both the website and sandbox payment API. No credentials are required for the default public test merchant.

## Commands

| Command               | Purpose                                                    |
| --------------------- | ---------------------------------------------------------- |
| `npm run dev`         | Start the website and sandbox API with hot reload          |
| `npm run typecheck`   | Strict TypeScript checks, including server and tests       |
| `npm run build`       | Type-check and build the frontend into `dist/`             |
| `npm run preview`     | Serve the frontend build and sandbox API locally           |
| `npm start`           | Serve `dist/` and the sandbox API using Node, on port 3001 |
| `npm run test:server` | Test signing, validation, catalogue pricing, and HTTP API  |
| `npm test`            | Run desktop and mobile browser tests                       |
| `npm run test:ui`     | Open Playwright's test runner                              |
| `npm run format`      | Format source, tests, and configuration                    |

Browser tests use installed Google Chrome. Run `npm run build` before `npm test`. Playwright starts and stops the production Node server automatically. The normal browser suite intercepts the external PayFast handoff; it does not complete real gateway transactions.

## Sandbox checkout

1. Add products to the cart and select **Review checkout**.
2. Enter your first name, surname, and email address.
3. Select **Continue to PayFast test**.
4. On PayFast's sandbox page, use the test wallet to complete payment, or cancel the transaction.
5. Both outcomes redirect to **https://qckruger.github.io/3d-prnt-preview/**.

The API calculates totals from the server's product catalogue, validates customer details and quantities, creates a unique checkout reference, and signs the form on the server. The browser cannot set the amount or redirect destinations. Only the sandbox payment destination is accepted by the frontend.

Default credentials use PayFast Support's public sandbox merchant with a passphrase (merchant ID `10004002`). These public test credentials are isolated from live payments. See [PayFast's current sandbox credential guidance](https://support.payfast.help/portal/en/kb/articles/why-am-i-getting-a-merchant-id-merchant-key-error-20-9-2022) and [custom integration documentation](https://developers.payfast.co.za/docs?capcode=xMzF).

To use your own sandbox account, copy `.env.example` to `.env` and set `PAYFAST_SANDBOX_MERCHANT_ID`, `PAYFAST_SANDBOX_MERCHANT_KEY`, and your account's `PAYFAST_SANDBOX_PASSPHRASE`. All three must be supplied together. The passphrase must match the one configured in your PayFast sandbox dashboard and be at most 32 characters. Incomplete custom credentials stop startup instead of falling back silently. When all three are absent, the public sandbox test merchant remains available.

```powershell
Copy-Item .env.example .env
```

Edit `.env` privately in your editor:

```dotenv
PAYFAST_SANDBOX_MERCHANT_ID=YOUR_SANDBOX_MERCHANT_ID
PAYFAST_SANDBOX_MERCHANT_KEY=YOUR_SANDBOX_MERCHANT_KEY
PAYFAST_SANDBOX_PASSPHRASE=YOUR_SANDBOX_PASSPHRASE
```

These are placeholders, not credentials. Never use live merchant credentials in this sandbox-only integration. Do not paste credentials into chat, commit `.env`, include it in `public/` or `dist/`, or place credentials in variables beginning with `VITE_`. Startup/build rejects payment-related `VITE_` variables, since Vite exposes that prefix to the browser. `.env` is Git-ignored, but it is still a plaintext file: restrict access to your Windows user and keep it out of shared folders/backups that are not protected.

The passphrase is never returned by the API or submitted to PayFast. The merchant ID and merchant key are included in PayFast's hosted checkout form by protocol, so they are visible to the paying browser; the private signing passphrase is the server-only secret. Do not treat a hidden input as secret storage.

For hosted deployments, supply these names as server-side secret environment settings. If using Azure App Service or Functions, use [Azure Key Vault references with managed identity](https://learn.microsoft.com/en-us/azure/app-service/app-service-key-vault-references), granting the app read access only to the secrets it needs. Keep sandbox and future live credentials separate. Rotate a leaked credential/passphrase in PayFast, update the server secret, and restart the app. Credentials do not belong in Cosmos DB or frontend settings. No cloud resources or secret values are created by this project.

`PAYFAST_RETURN_URL` and `PAYFAST_CANCEL_URL` can override the HTTPS redirect destinations. Their defaults are the exact GitHub Pages URL above, without additional query parameters. Vite loads `.env` during startup; restart after changing it. `npm start` also loads `.env`.

**Payment notifications are intentionally omitted.** There is no `notify_url`, order database, payment-status polling, or verified paid status. Returning from PayFast is not proof of payment. Sandbox payments do not place real orders, trigger fulfilment, or charge real money. The return/cancel destination alone does not distinguish the outcome.

## Source structure

```text
public/                  Static assets copied into the build
server/
  payfast.ts             Sandbox settings, signing, validation, and API
  vite-plugin.ts         API middleware for development and preview
  start.ts               Standalone Node server for built frontend and API
src/
  components/            Shared layout and home page sections
  data/catalogue.ts      Product catalogue and categories
  features/              Catalogue, cart/checkout, and custom enquiries
  hooks/                 Store, responsive behaviour, and page effects
  lib/                   Price formatting and payment API hooks
  App.tsx                Page composition
  main.tsx               React entry point and query provider
  styles.css             Responsive styles and animations
  types.ts               Product, enquiry, and payment types
tests/                   Server tests and desktop/mobile browser tests
```

Generated frontend bundles belong in `dist/` and are not edited or committed. The cart resets on refresh. Custom enquiries are downloaded as text briefs and never submitted. Selected STL, OBJ, and 3MF files stay on the user's device; only the filename is included in the brief. Google Fonts supplies the external fonts, with system font fallbacks.

## Security controls

- Malformed request URLs return HTTP 400. Unhandled request failures produce a generic error response instead of crashing the Node server or exposing stack traces.
- Checkout allows 20 POST attempts per socket client address per minute, plus 200 per minute across the process. Excess attempts receive HTTP 429 with `Retry-After`. Counters are held only in memory, use per-process salted address hashes, are bounded, and expire after one minute. Restarting the process resets them; multiple instances do not share limits.
- Forwarded client-IP headers are deliberately ignored. Behind a reverse proxy, clients can share the proxy's rate bucket. Add trusted per-client rate limiting at your hosting gateway before opening this to broad public traffic; do not trust arbitrary `X-Forwarded-For` values.
- Cross-site browser checkout requests are rejected using Origin/Fetch Metadata checks. No permissive CORS policy is added. Guest checkout remains intentionally unauthenticated; these checks are not an authentication system.
- Request bodies are limited to 16 KiB and must finish within 10 seconds. The standalone Node server also applies header/request/keep-alive timeouts and limits requests per connection.
- Every HTML response receives a fresh CSP nonce. Both development and production block untrusted inline scripts, event handlers, and style attributes; no unsafe-inline exception is used. Development permits WebSockets and nonced stylesheet injection for Vite hot reload. Production serves an explicit asset allowlist and rejects symbolic links, hidden files, source maps, and server/config paths.
- All requests are throttled in addition to the stricter checkout limit. The Node server caps concurrent connections and validates Host headers. Public-interface binding requires an HTTPS `APP_ORIGIN`; loopback testing remains available without it.
- `SECURITY_HTTPS_ONLY=true` adds HSTS for a host already configured to enforce HTTPS at its reverse proxy. It does not provide TLS or force HTTP redirects itself. Leave it unset for localhost testing.
- No customer records, orders, model files, or payment results are persisted. Rate counters and active form values are transient memory. No database or payment notification handler is introduced.

These headers are applied by the Node/Vite servers. A static GitHub Pages deployment does not run this middleware or its rate limiter.

Run `npm run security:check` for the full local gate. [SECURITY.md](SECURITY.md) describes the controls, verification, scope, and hosting requirements. The included CI workflow audits dependencies and runs these tests on pull requests, main pushes, and a weekly schedule once pushed to GitHub. New checkouts can enable the staged secret-check hook with `git config core.hooksPath .githooks`.

## Hosting

Run `npm ci`, `npm run build`, and `npm start` on a Node.js host. The default listen address is `127.0.0.1:3001`; configure `HOST` and `PORT` for your hosting environment. Use HTTPS through the host's reverse proxy. The Node server requires the repository's `server/` and `src/data/` source files as well as `dist/`.

For a public-interface listener, also set `APP_ORIGIN=https://your-test-host.example` with no path. This allowlists that hostname and enables HSTS; TLS and HTTP-to-HTTPS redirects must be enforced by the hosting proxy. Localhost is allowed for development. The asset allowlist is built on startup, so restart after rebuilding frontend assets.

GitHub Pages can serve the static frontend and act as the redirect destination, but cannot execute the payment API. Publishing `dist/` to Pages alone will not enable checkout there. The configured GitHub return destination is separate from the local sandbox-enabled website. No GitHub Pages files or hosting settings have been published or changed by this implementation.
