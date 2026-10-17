import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { products } from "../src/data/catalogue.ts";
import { localContent } from "../server/local-content.ts";
import {
  createCheckout,
  createPaymentHandler,
  DEFAULT_RETURN_URL,
  payfastEncode,
  sandboxSettings,
  signFields,
} from "../server/payfast.ts";

const settings = sandboxSettings({});
const buyer = {
  firstName: "Test",
  lastName: "Buyer",
  email: "sandbox-test@example.com",
  productIds: [1, 1, 4],
};

test("signature uses PHP encoding, ordered fields, non-empty values and a server-only passphrase", () => {
  assert.equal(
    payfastEncode(" A&B + O'Neil!*()~ "),
    "A%26B+%2B+O%27Neil%21%2A%28%29%7E",
  );
  const expected = createHash("md5")
    .update("name_first=John+%26+O%27Neil&amount=189.00&passphrase=test+pass")
    .digest("hex");
  assert.equal(
    signFields(
      {
        name_first: " John & O'Neil ",
        amount: "189.00",
        empty: "",
        signature: "ignored",
      },
      " test pass ",
    ),
    expected,
  );
});

test("checkout signs server catalogue prices, sandbox destination and exact GitHub redirects", () => {
  const checkout = createCheckout(
    { ...buyer, amount: "0.01", return_url: "https://attacker.example" },
    settings,
    products,
  );
  assert.equal(checkout.action, "https://sandbox.payfast.co.za/eng/process");
  assert.equal(checkout.fields.amount, "457.00");
  assert.equal(checkout.fields.return_url, DEFAULT_RETURN_URL);
  assert.equal(checkout.fields.cancel_url, DEFAULT_RETURN_URL);
  assert.equal(checkout.fields.notify_url, undefined);
  assert.equal(checkout.fields.passphrase, undefined);
  assert.match(checkout.fields.m_payment_id, /^3D-[\da-f-]{36}$/);
  assert.equal(
    checkout.fields.signature,
    signFields(checkout.fields, settings.passphrase),
  );
  assert.notEqual(
    checkout.fields.m_payment_id,
    createCheckout(buyer, settings, products).fields.m_payment_id,
  );
});

test("invalid customer, product IDs, personalised items and excessive quantities are rejected", () => {
  for (const input of [
    null,
    {},
    { ...buyer, email: "bad" },
    { ...buyer, firstName: "x".repeat(51) },
    { ...buyer, productIds: [] },
    { ...buyer, productIds: [999] },
    { ...buyer, productIds: ["1"] },
    { ...buyer, productIds: [5] },
    { ...buyer, productIds: Array(21).fill(1) },
  ]) {
    assert.throws(() => createCheckout(input, settings, products));
  }
});

test("custom sandbox credentials are configured together and redirect URLs require HTTPS", () => {
  assert.throws(() => sandboxSettings({ PAYFAST_SANDBOX_MERCHANT_ID: "123" }));
  assert.throws(() =>
    sandboxSettings({ PAYFAST_RETURN_URL: "http://example.com" }),
  );
  assert.throws(() =>
    sandboxSettings({
      PAYFAST_SANDBOX_MERCHANT_ID: "123",
      PAYFAST_SANDBOX_MERCHANT_KEY: "key",
    }),
  );
  assert.throws(() => sandboxSettings({ PAYFAST_SANDBOX_PASSPHRASE: "alone" }));
  assert.throws(() =>
    sandboxSettings({ VITE_PAYFAST_SANDBOX_PASSPHRASE: "TEST_NEVER_PUBLIC" }),
  );
  assert.throws(() =>
    sandboxSettings({
      PAYFAST_RETURN_URL: "https://user:password@example.com/",
    }),
  );
  const configured = sandboxSettings({
    PAYFAST_SANDBOX_MERCHANT_ID: "123",
    PAYFAST_SANDBOX_MERCHANT_KEY: "key",
    PAYFAST_SANDBOX_PASSPHRASE: "TEST_ONLY_PRIVATE_PASSPHRASE",
  });
  assert.equal(configured.passphrase, "TEST_ONLY_PRIVATE_PASSPHRASE");
  assert.equal(
    JSON.stringify(createCheckout(buyer, configured, products)).includes(
      "TEST_ONLY_PRIVATE_PASSPHRASE",
    ),
    false,
  );
});

test("HTTP API handles config, signed checkout, malformed payloads and unsupported requests", async () => {
  const server = createServer(
    createPaymentHandler(settings, {
      contentSource: {
        get: async () => ({ available: true, content: localContent }),
        close() {},
      },
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const config = await fetch(base + "/api/payment/config");
    assert.equal(config.headers.get("cache-control"), "no-store");
    assert.deepEqual(await config.json(), {
      enabled: true,
      mode: "sandbox",
      fulfilment: "collection",
      notificationsEnabled: false,
    });
    const checkout = await fetch(base + "/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buyer),
    });
    assert.equal(checkout.status, 200);
    assert.equal((await checkout.json()).fields.amount, "457.00");
    assert.equal((await fetch(base + "/api/payment/checkout")).status, 405);
    assert.equal(
      (
        await fetch(base + "/api/payment/checkout", {
          method: "POST",
          body: "bad",
        })
      ).status,
      415,
    );
    assert.equal(
      (
        await fetch(base + "/api/payment/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/api/payment/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: " ".repeat(17_000),
        })
      ).status,
      413,
    );
    assert.equal(
      (await fetch(base + "/api/payment/order/fake?token=fake")).status,
      404,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
