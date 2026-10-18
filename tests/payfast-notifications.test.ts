import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage } from "node:http";
import { once } from "node:events";
import {
  createPaymentNotifications,
  parseNotification,
  notificationSignature,
  notificationSourceAllowed,
  isAzureIisProxy,
  confirmWithPayfast,
  SANDBOX_VALIDATION_URL,
} from "../server/payfast-notifications.ts";
import { createPrivateRecords } from "../server/private-records.ts";
import type { PrivateRecords } from "../server/private-records.ts";
import { createGuestJourney } from "../server/guest-journey.ts";
import { unavailableReturns } from "../server/returns.ts";
import {
  createCheckout,
  createPaymentHandler,
  sandboxSettings,
  DEFAULT_RETURN_URL,
  DEFAULT_CANCEL_URL,
} from "../server/payfast.ts";
import { parseFulfilment, fulfilmentSettings } from "../server/fulfilment.ts";
import { HttpError } from "../server/security.ts";
import { products } from "../src/data/catalogue.ts";

const settings = sandboxSettings({});
const env = { NODE_ENV: "development" };
const request = {
  headers: {},
  socket: { remoteAddress: "144.126.193.139" },
} as IncomingMessage;
const encode = (value: string) =>
  encodeURIComponent(value)
    .replace(
      /[!'()*~]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/%20/g, "+");
function body(reference: string, patch: Record<string, string> = {}) {
  const fields = {
    m_payment_id: reference,
    pf_payment_id: "12345678",
    payment_status: "COMPLETE",
    item_name: " Printed item ",
    amount_gross: "189.00",
    amount_fee: "-5.35",
    amount_net: "183.65",
    custom_str1: "",
    email_address: "private@example.com",
    merchant_id: settings.merchantId,
    ...patch,
  };
  const parameters = Object.entries(fields)
    .map(([key, value]) => `${key}=${encode(value)}`)
    .join("&");
  return `${parameters}&signature=${notificationSignature(parameters, settings.passphrase)}`;
}
async function fixture(records = createPrivateRecords(env)) {
  const journey = createGuestJourney(env, unavailableReturns, records);
  const input = {
    requestId: randomUUID(),
    firstName: "Test",
    lastName: "Buyer",
    email: "buyer@example.com",
    productIds: [1],
  };
  const reference = `3D-${input.requestId}`;
  const checkout = createCheckout(input, settings, products, { reference });
  const receipt = await journey.saveOrder(
    input,
    checkout,
    products,
    parseFulfilment(undefined, fulfilmentSettings({})),
  );
  return {
    records,
    journey,
    reference,
    receipt,
    orderId: `order:${input.requestId}`,
  };
}

test("ITNs retain empty/whitespace fields, reject ambiguous encoding and migrate old redirect defaults", () => {
  const raw = body(`3D-${randomUUID()}`);
  const parsed = parseNotification(raw);
  assert.ok(parsed.parameterString.includes("item_name=+Printed+item+"));
  assert.ok(parsed.parameterString.includes("custom_str1=&"));
  assert.equal(parsed.grossCents, 18900);
  assert.equal(parsed.feeCents, -535);
  assert.equal(parsed.netCents, 18365);
  for (const invalid of [
    raw + "&extra=x",
    raw.replace("amount_gross=189.00", "amount_gross=1e2"),
    raw.replace("custom_str1=", "custom_str1=%zz"),
    raw.replace("amount_net=183.65", "amount_net=1.00"),
    raw.replace("&signature=", "&merchant_id=duplicate&signature="),
    raw.replace("pf_payment_id=12345678", "pf_payment_id=not-an-id"),
  ])
    assert.throws(() => parseNotification(invalid), { status: 400 });
  const migrated = sandboxSettings({
    PAYFAST_RETURN_URL: "https://qckruger.github.io/3d-prnt-preview/",
    PAYFAST_CANCEL_URL: "https://qckruger.github.io/3d-prnt-preview/",
  });
  assert.equal(migrated.returnUrl, DEFAULT_RETURN_URL);
  assert.equal(migrated.cancelUrl, DEFAULT_CANCEL_URL);
  assert.throws(() =>
    sandboxSettings({
      PAYFAST_NOTIFY_URL: "http://example.com/api/payment/notify",
    }),
  );
  assert.throws(() =>
    sandboxSettings({
      PAYFAST_NOTIFY_URL: "https://example.com/api/payment/notify?secret=x",
    }),
  );
});

test("notification source checks cannot be bypassed using Referer or a caller-selected forwarding prefix", () => {
  const req = (remote: string, forwarded?: string) =>
    ({
      socket: { remoteAddress: remote },
      headers: {
        referer: "https://sandbox.payfast.co.za",
        ...(forwarded ? { "x-forwarded-for": forwarded } : {}),
      },
    }) as IncomingMessage;
  assert.equal(notificationSourceAllowed(req("144.126.193.139")), true);
  assert.equal(notificationSourceAllowed(req("::ffff:197.97.145.145")), true);
  assert.equal(
    notificationSourceAllowed(req("127.0.0.1", "144.126.193.139")),
    false,
  );
  assert.equal(
    notificationSourceAllowed(
      req("127.0.0.1", "144.126.193.139, 203.0.113.1"),
      true,
    ),
    false,
  );
  assert.equal(
    notificationSourceAllowed(
      req("127.0.0.1", "203.0.113.1, 144.126.193.139:443"),
      true,
    ),
    true,
  );
  assert.equal(
    notificationSourceAllowed(req("203.0.113.1", "144.126.193.139"), true),
    false,
  );
  assert.equal(
    isAzureIisProxy({
      NODE_ENV: "production",
      WEBSITE_SITE_NAME: "app",
      PORT: "\\\\.\\pipe\\app",
    }),
    true,
  );
  assert.equal(
    isAzureIisProxy({
      NODE_ENV: "production",
      WEBSITE_SITE_NAME: "app",
      PORT: "3001",
    }),
    false,
  );
});

test("verified ITNs persist minimal transaction/event data, advance tracking, replay safely and never downgrade completed payment", async () => {
  const f = await fixture();
  const logs: string[] = [];
  const service = createPaymentNotifications(settings, f.records, {
    confirm: async (parameters) => {
      assert.ok(!parameters.includes("passphrase="));
      return true;
    },
    log: (message) => {
      logs.push(message);
    },
  });
  const raw = body(f.reference);
  await service.receive(raw, request);
  await service.receive(raw, request);
  const transaction = await f.records.read(
    "transaction:payfast:sandbox:12345678",
  );
  assert.equal(transaction?.EntityType, "Transaction");
  assert.equal(transaction?.paymentStatus, "COMPLETE");
  assert.equal(transaction?.grossCents, 18900);
  for (const privateValue of [
    "private@example.com",
    '"signature":',
    "merchant_key",
    "passphrase",
    "Printed item",
  ])
    assert.ok(!JSON.stringify(transaction).includes(privateValue));
  let order = await f.records.read(f.orderId);
  assert.equal(order?.paymentStatus, "verified-sandbox");
  assert.equal(
    (order?.fulfilment as { status: string }).status,
    "awaiting-processing",
  );
  const view = await f.journey.view(f.receipt.tracking.token);
  assert.equal(view.paymentStatus, "verified-sandbox");
  assert.equal(view.status, "awaiting-processing");
  await service.receive(
    body(f.reference, { payment_status: "FAILED" }),
    request,
  );
  await service.receive(
    body(f.reference, { payment_status: "PENDING" }),
    request,
  );
  order = await f.records.read(f.orderId);
  assert.equal(order?.paymentStatus, "verified-sandbox");
  assert.equal(
    (await f.records.read("transaction:payfast:sandbox:12345678"))
      ?.paymentStatus,
    "COMPLETE",
  );
  const checkout = createCheckout(
    {
      firstName: "Test",
      lastName: "Buyer",
      email: "buyer@example.com",
      productIds: [1],
    },
    settings,
    products,
    { reference: f.reference },
  );
  await assert.rejects(
    f.journey.saveOrder(
      { productIds: [1] },
      checkout,
      products,
      parseFulfilment(undefined, fulfilmentSettings({})),
    ),
    { status: 409 },
  );
  assert.ok(!logs.join("\n").includes("private@example.com"));
  f.journey.close();
});

test("invalid signatures, merchants, amounts, sources, unknown orders and provider rejections write no transactions", async () => {
  const f = await fixture();
  let providerCalls = 0;
  const service = createPaymentNotifications(settings, f.records, {
    confirm: async () => {
      providerCalls++;
      return true;
    },
    log() {},
  });
  await assert.rejects(
    service.receive(
      body(f.reference).replace(/signature=.*/, "signature=" + "0".repeat(32)),
      request,
    ),
    { status: 403 },
  );
  await assert.rejects(
    service.receive(body(f.reference, { merchant_id: "99999999" }), request),
    { status: 403 },
  );
  await assert.rejects(
    service.receive(
      body(f.reference, { amount_gross: "100.00", amount_net: "94.65" }),
      request,
    ),
    { status: 400 },
  );
  await assert.rejects(service.receive(body(`3D-${randomUUID()}`), request), {
    status: 400,
  });
  await assert.rejects(
    service.receive(body(f.reference), {
      ...request,
      socket: { remoteAddress: "203.0.113.1" },
    } as IncomingMessage),
    { status: 403 },
  );
  assert.equal(providerCalls, 0);
  const rejected = createPaymentNotifications(settings, f.records, {
    confirm: async () => false,
    log() {},
  });
  await assert.rejects(rejected.receive(body(f.reference), request), {
    status: 403,
  });
  assert.equal(
    await f.records.read("transaction:payfast:sandbox:12345678"),
    undefined,
  );
  assert.equal((await f.records.read(f.orderId))?.paymentStatus, "unverified");
  f.journey.close();
});

test("a partially persisted callback returns retryable failure and a later callback repairs payment state", async () => {
  const records = createPrivateRecords(env);
  const f = await fixture(records);
  let failOrderUpdate = true;
  let conflict = true;
  const wrapper: PrivateRecords = {
    ...records,
    async replace(document, etag) {
      if (document.EntityType === "Order" && failOrderUpdate)
        throw new HttpError(503, "temporary database outage");
      if (conflict) {
        conflict = false;
        throw new HttpError(412, "concurrent update");
      }
      await records.replace(document, etag);
    },
  };
  const service = createPaymentNotifications(settings, wrapper, {
    confirm: async () => true,
    log() {},
  });
  await assert.rejects(service.receive(body(f.reference), request), {
    status: 503,
  });
  assert.equal(
    (await records.read("transaction:payfast:sandbox:12345678"))?.paymentStatus,
    "COMPLETE",
  );
  assert.equal((await records.read(f.orderId))?.paymentStatus, "unverified");
  failOrderUpdate = false;
  await service.receive(
    body(f.reference, { payment_status: "FAILED" }),
    request,
  );
  assert.equal(
    (await records.read(f.orderId))?.paymentStatus,
    "verified-sandbox",
  );
  const other = await fixture(records);
  await assert.rejects(service.receive(body(other.reference), request), {
    status: 409,
  });
  assert.equal(
    (await records.read(other.orderId))?.paymentStatus,
    "unverified",
  );
  records.close();
});

test("PayFast confirmation uses only the fixed sandbox URL, requires VALID and fails closed on provider errors", async () => {
  const original = mock.method(
    globalThis,
    "fetch",
    async (url: string | URL | Request, options?: RequestInit) => {
      assert.equal(url, SANDBOX_VALIDATION_URL);
      assert.equal(options?.redirect, "error");
      assert.equal(options?.body, "merchant_id=10004002");
      return new Response("VALID");
    },
  );
  try {
    assert.equal(await confirmWithPayfast("merchant_id=10004002"), true);
  } finally {
    original.mock.restore();
  }
  for (const item of [
    { text: "INVALID", status: 200, error: false },
    { text: "x".repeat(129), status: 200, error: true },
    { text: "error", status: 500, error: true },
  ]) {
    const stub = mock.method(
      globalThis,
      "fetch",
      async () => new Response(item.text, { status: item.status }),
    );
    try {
      if (item.error)
        await assert.rejects(confirmWithPayfast("x=y"), { status: 503 });
      else assert.equal(await confirmWithPayfast("x=y"), false);
    } finally {
      stub.mock.restore();
    }
  }
});

test("HTTP notification route accepts server form posts and acknowledges only completed persistence", async () => {
  const f = await fixture();
  const notifications = createPaymentNotifications(settings, f.records, {
    confirm: async () => true,
    sourceAllowed: () => true,
    log() {},
  });
  const server = createServer(
    createPaymentHandler(settings, { paymentNotifications: notifications }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + "/api/payment/notify")).status, 405);
    assert.equal(
      (
        await fetch(base + "/api/payment/notify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      415,
    );
    const response = await fetch(base + "/api/payment/notify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body(f.reference),
    });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "OK");
    assert.equal(
      (await f.records.read(f.orderId))?.paymentStatus,
      "verified-sandbox",
    );
    assert.equal(
      (await (await fetch(base + "/api/payment/config")).json())
        .notificationsEnabled,
      true,
    );
    const oversized = await fetch(base + "/api/payment/notify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "a=" + "x".repeat(17000),
    });
    assert.equal(oversized.status, 413);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    f.journey.close();
  }
});
