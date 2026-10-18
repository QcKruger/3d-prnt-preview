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

## Azure data access

Deployment reads products, categories, FAQs, services and process steps only from Cosmos DB through the server's **system-assigned managed identity**. No database keys or connection strings are used. Empty or unavailable Cosmos data hides those content sections; the site shell remains available. Content refreshes every ten seconds and recovers automatically. Checkout re-reads the same server catalogue and uses its integer-cent prices. Private sandbox orders, transactions, notification events, return cases and hashed tracking grants are saved in the same container; user accounts and live payments remain unimplemented.

Only explicit local development (`npm run dev`) uses the local catalogue and content seed. Production builds contain no sample product/FAQ data, and deployment packages exclude the local loader and seed files. `npm start` and `npm run preview` use Cosmos by default. Import [the seed documents](data/cosmos-seed/README.md) into the configured container to populate the deployed site.

See [Azure setup and deployment](AZURE.md) for the App Service configuration script, container-scoped data permissions, server environment settings and local Azure CLI testing.

Azure Deployment Center created `.github/workflows/main_3dprntweb.yml` for Windows App Service **3dprntweb**, including OIDC authentication. This single deployment workflow runs security checks, packages the Windows application and deploys pushes to **main**. It configures the system-assigned identity and runtime settings; that identity must separately have container-scoped Cosmos data permissions. See [AZURE.md](AZURE.md).

## Guest returns

A 10% handling fee is disclosed before submission and acknowledged in the required checkbox. It is deducted from any approved refund amount (R100 approved → R10 fee → R90 paid), not charged when the request is submitted. The confirmation/download repeat the policy. Each saved case snapshots the server-controlled fee percentage, basis, acknowledgement time and policy version; `amountCents` remains null until a refund amount is verified during review. Clients cannot override the fee. No automatic deduction or PayFast refund is executed by the intake flow.

The **Returns** link opens `#returns`. Customers can submit their name, email, order/payment reference, item, quantity, reason, explanation and preferred outcome without an account. Damage, faults, incorrect items, description differences, change of mind and other explanations are accepted for review. This is a request intake flow, not an eligibility decision or automatic refund.

`POST /api/returns` validates the input and saves a private `ReturnRequest` document in the existing Cosmos `Items` container using the runtime system-assigned identity. The container uses `/ID`; both `id` and `ID` are `return:<UUID>`. The existing container-scoped **Cosmos DB Built-in Data Contributor** assignment supplies create/read permissions. No new secrets or Azure resources are needed. Return records are excluded from `/api/content`; there is no public list, reference/email lookup, update or refund API. A successful response also attempts to issue a private, expiring tracking link. If issuing that link fails, the saved case still returns its reference without claiming a link was created.

Each document records `status: pending-review`, `orderVerification: unverified`, `customerId: null`, UTC creation/consent timestamps and explicitly projected customer-supplied fields. These fields leave room to link a verified customer/order later; a guest-supplied email or reference is never proof of ownership or payment. Retrying unchanged details in the same open form uses the same UUID; a Cosmos create conflict is accepted only when the stored submission hash matches. It never overwrites an earlier case. Keep the form open after a connection failure to retry safely; refreshing or changing the details creates a new request identifier.

Only local development simulates requests in bounded server memory (up to 1,000 cases, 24-hour expiry, cleared on restart). The confirmation and downloaded reference clearly identify local tests. Deployed code never falls back to that memory store: failed saves return 503 and do not show a success receipt. Private failure diagnostics use the existing Cosmos log, without request bodies or contact details.

Until an authenticated staff interface is added, authorized staff can review cases through **Cosmos Data Explorer → 3dprnt → Items**, using:

```sql
SELECT * FROM c WHERE c["EntityType"] = 'ReturnRequest'
```

No email notifications, photo uploads, order verification or PayFast refunds are implemented. The customer can download the reference and private tracking link as a text receipt. Review pending cases manually, contact the supplied email through the business's support process and agree instructions before an item is sent back. Staff access, retention/deletion policy and the full business returns/privacy terms remain operational decisions before accepting real orders; the form does not invent return windows or statutory exclusions.

Return submissions share the existing host/origin, JSON body-size and request-timeout controls, with a separate limit of five submission attempts per socket address per ten minutes and fifty per process. Rate counters are per process and clients behind the same proxy can share a bucket; retain gateway-level abuse controls for public scale.

## Sandbox checkout

Checkout offers free collection or **R99 delivery** across South Africa by default. Delivery requires recipient, phone, street, city, province and a four-digit postal code; suburb is optional. Only the selected delivery address is saved, and collection discards any submitted address. Delivery costs are validated and added by the server before signing PayFast's total. A private `Order` snapshot is saved before the payment handoff, with item quantities/unit prices, contact details, selected fulfilment and its fee, the subtotal/total, `paymentMode: sandbox`, `paymentStatus: unverified` and `customerId: null`. Retry IDs protect the initial snapshot from accidental overwrite. Validated notifications can establish a sandbox-only confirmed state; no real fulfilment is triggered.

Before opening PayFast, a checkout-saved screen lets the customer copy/download the private tracking link. Existing return/cancel URLs stay unchanged. A saved snapshot does not prove payment or place a real order.

Configure the following **server environment settings**, then restart the app. The workflow does not overwrite these settings:

| Setting                    | Default                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `DELIVERY_ENABLED`         | `true` (`false` disables delivery)                                       |
| `DELIVERY_FEE_CENTS`       | `9900` (integer ZAR cents, permits zero)                                 |
| `DELIVERY_PROVINCES`       | All nine South African provinces, comma-separated names                  |
| `DELIVERY_ESTIMATE`        | Estimated 3–5 business days after dispatch; remote areas may take longer |
| `COLLECTION_ADDRESS`       | Collection location will be confirmed by the studio                      |
| `COLLECTION_HOURS`         | By arrangement; wait for confirmation before travelling                  |
| `GUEST_TRACKING_TTL_HOURS` | `168` (7 days; allowed 1–720 hours)                                      |

The collection placeholders deliberately avoid publishing an invented street address or opening hours. Replace them with the studio's real details in App Service → Environment variables before offering a confirmed collection location. Rates, collection details and delivery wording are snapshotted per checkout, so changing settings affects new checkouts.

## Guest tracking

Customers can open a saved private link or paste it into the tracking section at `#tracking`. Links are issued only after a case/checkout is saved and are bearer credentials: anyone holding one can see that record's limited status view. There is no email delivery or lost/expired-link recovery yet. Save the link before leaving checkout; a reference/email alone cannot retrieve a record.

Tokens use 32 random bytes and only their SHA-256 hashes are stored as `GuestTracking` records. Raw tokens go in the URL fragment (`/#track=...`), not HTTP paths or query parameters, and the client immediately removes the fragment token from the current history entry. Status reads use `POST /api/tracking/view` with `no-store`, origin/host checks and a 30/address/minute, 500/process/minute limiter. Status projection excludes customer contact, addresses, internal notes, payment fields and tokens. A token is scoped to one order or return. Expiry is always checked by the server; deleting its grant revokes it. `ttl` is also written for Cosmos cleanup **if container TTL is enabled**; expiry does not depend on TTL cleanup. Expired grants need operational cleanup where Cosmos TTL is disabled.

Orders and grants use `id` = `ID` with prefixes `order:` and `tracking:` in the `/ID` container. Local development holds up to 3,000 such records in memory with 24-hour expiry; restarting clears them regardless of the link's displayed expiry. Production never falls back to local memory. Keep order/return data retention separate from the short-lived grants; no automatic deletion of order/return history is introduced.

Until a staff dashboard is added, authorized operators can inspect `Order` and `ReturnRequest` records in Cosmos Data Explorer. For an order, update only `fulfilment.status` to one of `preparing`, `ready-for-collection`, `collected`, `dispatched`, `delivered`, `cancelled` as appropriate for its collection/delivery method. For returns, supported `status` values are `pending-review`, `under-review`, `approved`, `declined`, `awaiting-item`, `received`, `resolved`, `cancelled`. Keep `submissionHash`, IDs, original prices, contact details, fee snapshots and token grants unchanged. Do not mark sandbox records as real paid orders; guest order views distinguish unverified payments from payments verified through a sandbox ITN. Never edit payment state manually; only a validated callback may establish it. Customer pages can check for updates; no unauthenticated staff update route is exposed.

## PayFast sandbox handoff

1. Add products to the cart and select **Review checkout**.
2. Enter your first name, surname, and email address.
3. Select **Continue to PayFast test**.
4. On PayFast's sandbox page, use the test wallet to complete payment, or cancel the transaction.
5. Save the private tracking link, then select **Open PayFast test**. Completed and cancelled checkout flows return to the Azure site, with `?payment=return` or `?payment=cancel` respectively. Neither browser redirect confirms a payment.

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

`PAYFAST_RETURN_URL`, `PAYFAST_CANCEL_URL` and `PAYFAST_NOTIFY_URL` configure the HTTPS destinations. They default to the Azure URLs in `.env.example`. A legacy setting equal to the former GitHub Pages URL migrates to the new return/cancel defaults. The Azure deployment workflow explicitly sets all three URLs from the deployed hostname. Vite loads `.env` during startup; restart after changing it. `npm start` also loads `.env`.

## PayFast notification processing

The signed checkout form includes `notify_url=https://3dprntweb-e2hwa9g0hdc8g3fj.westus3-01.azurewebsites.net/api/payment/notify`. That endpoint accepts bounded UTF-8 `application/x-www-form-urlencoded` POSTs from PayFast. It verifies the ordered, complete ITN signature with the server passphrase, the configured merchant, PayFast's documented source IP ranges, the stored order's merchant/currency/sandbox binding and exact integer-cent gross amount, and an HTTPS `VALID` response from the fixed sandbox `/eng/query/validate` endpoint. Duplicate form keys, malformed encoding, missing fields, unexpected statuses and fields after the signature are rejected. Redirects, Referer headers, customer-submitted amounts and arbitrary forwarding prefixes are not proof of payment. See [PayFast's notification documentation](https://developers.payfast.co.za/documentation) and [official notification implementation](https://github.com/Payfast/payfast-php-sdk/blob/master/lib/PaymentIntegrations/Notification.php).

Accepted callbacks save a private `Transaction` document keyed by `transaction:payfast:sandbox:<pf_payment_id>` and an immutable `PaymentEvent` keyed by the payment ID and canonical payload hash. Both have `ID` equal to `id` for the `/ID` container. Stored data is explicitly projected: merchant/provider payment ID, order reference, gross/fee/net cents, currency, status, verification method and timestamps. Raw webhook bodies, signatures, passphrases and payer emails are not stored in transaction/event records or logs. All of these entity types remain excluded from the public content query.

A validated `COMPLETE` advances the matching order to `paymentStatus: verified-sandbox` and `status: sandbox-payment-confirmed`, with the transaction reference and verification time. Fulfilment advances only from `awaiting-payment-verification` to `awaiting-processing`; no shipment, real fulfilment, refund or email is triggered. Tracking shows the verified sandbox state. Valid `FAILED`, `CANCELLED` and `PENDING` events are recorded without treating them as completed payments, and completed transactions/orders cannot be downgraded by a later stale failure. A provider payment ID cannot be rebound to a different order. Checkout snapshots pin the merchant at creation; create a new checkout for older records that predate this binding.

Writes use create-only IDs and ETag/If-Match conditional updates with bounded contention retries. Order and transaction documents occupy separate partitions, so this is a replay-safe workflow rather than a cross-partition atomic transaction. Only after persistence succeeds does the endpoint return HTTP 200 `OK`. Provider/database failures return retryable 503; replaying the same notification repairs partial writes without duplicating the payment event. A completed transaction can repair an incomplete order summary even when a stale failure arrives next. Inspect private operational logs at `%HOME%/LogFiles/3dprnt/payfast.log` and Cosmos failures in `cosmos.log`. Logs contain controlled stage/status information, not payloads or credentials.

The Windows App Service runtime trusts exactly one Azure platform forwarding hop, from the rightmost `X-Forwarded-For` entry, only when running as a production App Service behind IISNode's named pipe. Direct/local servers use the socket peer and ignore forwarding/Referer claims. Keep the documented PayFast IP ranges in `server/payfast-notifications.ts` current if PayFast changes its infrastructure. No bypass of signature, source, amount or provider checks is available through an environment setting.

PayFast cannot call localhost; create the sandbox checkout on the deployed Azure site for an end-to-end notification test. Deployed transactions use Cosmos only through the existing system identity and its container-scoped Data Contributor role. Local development simulates records in memory but does not waive notification security checks. Use your own sandbox merchant ID/key/passphrase in App Service settings to see notifications for your merchant in PayFast's dashboard. Public demo merchant credentials are shared test credentials and provide no live-payment security. This app remains sandbox-only; returning from PayFast never confirms a payment, and a verified sandbox payment never charges real money.

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
  features/              Catalogue, cart/checkout, custom enquiries, guest returns
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
- Guest return cases, sandbox checkout snapshots, validated sandbox transaction/event records and hashed tracking grants are persisted privately in Cosmos. Model files and live payment results are not stored. Active form values and rate counters remain transient.

These headers are applied by the Node/Vite servers. A static GitHub Pages deployment does not run this middleware or its rate limiter.

Run `npm run security:check` for the full local gate. [SECURITY.md](SECURITY.md) describes the controls, verification, scope, and hosting requirements. The included CI workflow audits dependencies and runs these tests on pull requests, main pushes, and a weekly schedule once pushed to GitHub. New checkouts can enable the staged secret-check hook with `git config core.hooksPath .githooks`.

## Hosting

Run `npm ci`, `npm run build`, and `npm start` on a Node.js host. The default listen address is `127.0.0.1:3001`; configure `HOST` and `PORT` for your hosting environment. Use HTTPS through the host's reverse proxy. Use the deployment packaging script for the required runtime files (`dist/`, `server/`, and the shared `src/content.ts`, `src/types.ts`, `src/returns.ts`, `src/tracking.ts`, `src/fulfilment.ts` modules); local seeds are excluded.

For a public-interface listener, also set `APP_ORIGIN=https://your-test-host.example` with no path. This allowlists that hostname and enables HSTS; TLS and HTTP-to-HTTPS redirects must be enforced by the hosting proxy. Localhost is allowed for development. The asset allowlist is built on startup, so restart after rebuilding frontend assets.

GitHub Pages can serve the static frontend and act as the redirect destination, but cannot execute the payment API. Publishing `dist/` to Pages alone will not enable checkout there. Payments now return to the Azure App Service. No GitHub Pages hosting settings are changed by this implementation.
