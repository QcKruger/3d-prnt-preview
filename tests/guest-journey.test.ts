import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  createCheckout,
  createPaymentHandler,
  sandboxSettings,
} from "../server/payfast.ts";
import { fulfilmentSettings, parseFulfilment } from "../server/fulfilment.ts";
import {
  createGuestJourney,
  checkoutRequestId,
} from "../server/guest-journey.ts";
import { createPrivateRecords } from "../server/private-records.ts";
import type { PrivateRecord } from "../server/private-records.ts";
import { createReturnStore, parseReturn } from "../server/returns.ts";
import { products } from "../src/data/catalogue.ts";
import { localContent } from "../server/local-content.ts";
import { parseContent } from "../server/content.ts";
import type { createCosmosConnection } from "../server/cosmos.ts";

const env = { NODE_ENV: "development" };
const buyer = () => ({
  requestId: randomUUID(),
  firstName: "Test",
  lastName: "Guest",
  email: "test@example.com",
  productIds: [1, 1],
});
const address = {
  recipient: "Test Guest",
  phone: "0821234567",
  street: "12 Test Street",
  suburb: "",
  city: "Pretoria",
  province: "Gauteng",
  postalCode: "0001",
  country: "ZA",
};

test("fulfilment fees and coverage are server configured; collection omits an injected address", () => {
  const config = fulfilmentSettings({
    DELIVERY_FEE_CENTS: "12000",
    DELIVERY_PROVINCES: "Gauteng",
    COLLECTION_ADDRESS: "Studio collection by arrangement",
  });
  const input = {
    ...buyer(),
    fulfilment: { method: "delivery", feeCents: 0, address },
    amount: "0.01",
  };
  const checkout = createCheckout(input, sandboxSettings({}), products, {
    fulfilment: config,
  });
  assert.equal(checkout.fields.amount, "498.00");
  const collection = parseFulfilment(
    { method: "collection", address, feeCents: 9000 },
    config,
  );
  assert.equal(collection.feeCents, 0);
  assert.ok(!("address" in collection));
  for (const patch of [
    { postalCode: "abc" },
    { province: "Western Cape" },
    { country: "US" },
    { phone: "123" },
    { street: "" },
    { recipient: "x\u0000y" },
  ])
    assert.throws(
      () =>
        parseFulfilment(
          { method: "delivery", address: { ...address, ...patch } },
          config,
        ),
      { status: 400 },
    );
  assert.throws(
    () =>
      parseFulfilment(
        { method: "delivery", address },
        fulfilmentSettings({ DELIVERY_ENABLED: "false" }),
      ),
    { status: 400 },
  );
  for (const invalid of [
    { DELIVERY_FEE_CENTS: "-1" },
    { DELIVERY_FEE_CENTS: "0.5" },
    { DELIVERY_PROVINCES: "Unknown" },
    { DELIVERY_ENABLED: "yes" },
  ])
    assert.throws(() => fulfilmentSettings(invalid));
  assert.throws(
    () => checkoutRequestId({ requestId: "order-chosen-by-attacker" }),
    { status: 400 },
  );
});

test("saved orders are idempotent and private tracking tokens are hashed, scoped, expire and exclude personal data", async () => {
  const documents = new Map<string, PrivateRecord>();
  const records = {
    local: false,
    async create(d: PrivateRecord) {
      if (documents.has(d.id)) {
        const { HttpError } = await import("../server/security.ts");
        throw new HttpError(409, "exists");
      }
      documents.set(d.id, structuredClone(d));
    },
    async read(id: string) {
      return documents.get(id);
    },
    async replace(document: PrivateRecord, _etag: string) {
      documents.set(document.id, document);
    },
    close() {},
  };
  const returns = createReturnStore(env);
  let time = Date.now();
  const journey = createGuestJourney(
    { GUEST_TRACKING_TTL_HOURS: "1" },
    returns,
    records,
    () => time,
  );
  const input = { ...buyer(), fulfilment: { method: "delivery", address } };
  const reference = `3D-${input.requestId}`;
  const checkout = createCheckout(input, sandboxSettings({}), products, {
    reference,
  });
  const fulfilment = parseFulfilment(input.fulfilment, fulfilmentSettings({}));
  const receipt = await journey.saveOrder(
    input,
    checkout,
    products,
    fulfilment,
  );
  assert.equal(receipt.totalCents, 47700);
  assert.equal(receipt.subtotalCents, 37800);
  const again = await journey.saveOrder(input, checkout, products, fulfilment);
  assert.equal(again.reference, receipt.reference);
  assert.equal(
    [...documents.values()].filter((d) => d.EntityType === "Order").length,
    1,
  );
  assert.ok(
    !JSON.stringify([...documents.values()]).includes(receipt.tracking.token),
  );
  assert.equal(parseContent([...documents.values()]).products.length, 0);
  let view = await journey.view(receipt.tracking.token);
  assert.equal(view.status, "awaiting-payment-verification");
  assert.equal(view.paymentStatus, "unverified");
  for (const secret of [
    "test@example.com",
    "0821234567",
    "12 Test Street",
    "submissionHash",
    "merchant_key",
    "signature",
  ])
    assert.ok(!JSON.stringify(view).includes(secret));
  const order = documents.get(`order:${input.requestId}`)!;
  assert.equal((order.contact as { email: string }).email, "test@example.com");
  (order.fulfilment as { status: string }).status = "dispatched";
  view = await journey.view(receipt.tracking.token);
  assert.equal(view.status, "dispatched");
  assert.equal(view.paymentStatus, "unverified");
  await assert.rejects(
    journey.saveOrder(
      { ...input, productIds: [1] },
      checkout,
      products,
      fulfilment,
    ),
    { status: 409 },
  );
  await assert.rejects(journey.view("x".repeat(43)), { status: 404 });
  await assert.rejects(journey.view(reference), { status: 404 });
  time += 3_600_001;
  await assert.rejects(journey.view(receipt.tracking.token), { status: 404 });
  returns.close();
  journey.close();
});

test("guest return links read the saved case and do not expose the customer or supplied order reference", async () => {
  const returns = createReturnStore(env);
  const journey = createGuestJourney(env, returns);
  const submission = parseReturn({
    requestId: randomUUID(),
    name: "Private Customer",
    email: "private@example.com",
    item: "Planter",
    orderReference: "PRIVATE-ORDER",
    quantity: "1",
    reason: "damaged",
    description: "The item was broken when I opened the box.",
    resolution: "refund",
    consent: true,
  });
  const receipt = await returns.submit(submission);
  const access = await journey.returnTracking(receipt.reference);
  const view = await journey.view(access.token);
  assert.equal(view.kind, "return");
  assert.equal(view.status, "pending-review");
  assert.equal(view.handlingFeePercent, 10);
  assert.ok(!JSON.stringify(view).includes("private@example.com"));
  assert.ok(!JSON.stringify(view).includes("PRIVATE-ORDER"));
  returns.close();
  journey.close();
});

test("deployed private storage never substitutes local data, including failed Cosmos creates", async () => {
  const config = {
    NODE_ENV: "production",
    COSMOS_ENDPOINT: "https://example.documents.azure.com",
    COSMOS_DATABASE: "store",
    COSMOS_CONTAINER: "Items",
  };
  const connect = (() => ({
    client: { dispose() {} },
    container: {
      items: {
        async create() {
          throw { code: 404 };
        },
      },
    },
  })) as unknown as typeof createCosmosConnection;
  const logs: string[] = [];
  const records = createPrivateRecords(config, connect, async (message) => {
    logs.push(message);
  });
  await assert.rejects(
    records.create({ id: "order:test", ID: "order:test", EntityType: "Order" }),
    { status: 503 },
  );
  assert.match(logs[0], /phase=write.*HTTP 404/);
  records.close();
});

test("HTTP guest tracking requires a private token and security checks; checkout persists its server-priced delivery choice", async () => {
  const returns = createReturnStore(env);
  const journey = createGuestJourney(env, returns);
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), {
      guestJourney: journey,
      returnStore: returns,
      contentSource: {
        get: async () => ({ available: true, content: localContent }),
        close() {},
      },
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const info = server.address();
  assert.ok(info && typeof info !== "string");
  const base = `http://127.0.0.1:${info.port}`;
  const post = (path: string, body: unknown, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    const checkoutResponse = await post("/api/payment/checkout", {
      ...buyer(),
      fulfilment: { method: "delivery", feeCents: 0, address },
      amount: "0.01",
    });
    assert.equal(checkoutResponse.status, 200);
    const checkout = await checkoutResponse.json();
    assert.equal(checkout.fields.amount, "477.00");
    assert.equal(checkout.order.fulfilment.feeCents, 9900);
    const token = checkout.order.tracking.token;
    const response = await post("/api/tracking/view", { token });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!JSON.stringify(await response.json()).includes(address.street));
    assert.equal(
      (
        await post(
          "/api/tracking/view",
          { token },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      (await fetch(base + "/api/tracking/view?token=" + token)).status,
      405,
    );
    assert.equal(
      (
        await post("/api/tracking/view", {
          reference: checkout.order.reference,
          email: "test@example.com",
        })
      ).status,
      404,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    journey.close();
    returns.close();
  }
});
