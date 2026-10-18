import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import {
  createReturnStore,
  parseReturn,
  returnDocument,
} from "../server/returns.ts";
import type { ReturnDocument } from "../server/returns.ts";
import type { createCosmosConnection } from "../server/cosmos.ts";
import { createPaymentHandler, sandboxSettings } from "../server/payfast.ts";
import { checkoutLimiter } from "../server/security.ts";
import { parseContent } from "../server/content.ts";

const input = () => ({
  requestId: randomUUID(),
  name: "Test Customer",
  email: " TEST@example.com ",
  orderReference: "3D-test-order",
  item: "Printed planter",
  quantity: "1",
  reason: "damaged",
  description: "The planter arrived with a crack through the base.",
  resolution: "replacement",
  consent: true,
});
const production = {
  NODE_ENV: "production",
  COSMOS_ENDPOINT: "https://example.documents.azure.com",
  COSMOS_DATABASE: "store",
  COSMOS_CONTAINER: "Items",
};

test("return validation rejects malformed inputs and clients cannot approve requests or inject private fields", () => {
  const original = input();
  const parsed = parseReturn({
    ...original,
    status: "approved",
    customerId: "impersonated",
    EntityType: "Product",
    refundAmount: 100,
    handlingFee: { percent: 0, amountCents: 0 },
  });
  const document = returnDocument(parsed);
  assert.equal(document.status, "pending-review");
  assert.equal(document.customerId, null);
  assert.equal(document.EntityType, "ReturnRequest");
  assert.equal(document.orderVerification, "unverified");
  assert.equal(document.contact.email, "test@example.com");
  assert.equal(document.id, document.ID);
  assert.deepEqual(document.handlingFee, {
    percent: 10,
    basis: "approved-refund-amount",
    amountCents: null,
    acknowledgedAt: document.createdAt,
    policyVersion: "handling-fee-v1",
  });
  assert.ok(!JSON.stringify(document).includes("refundAmount"));
  assert.equal(parseContent([document]).products.length, 0);
  for (const patch of [
    { requestId: "guessed" },
    { quantity: "0" },
    { quantity: "101" },
    { quantity: 1 },
    { name: "x" },
    { email: "invalid" },
    { description: "too short" },
    { description: "x".repeat(3001) },
    { reason: "__proto__" },
    { resolution: "approved" },
    { consent: "true" },
    { consent: false },
    { item: "x\u0000y" },
  ]) {
    assert.throws(() => parseReturn({ ...original, ...patch }), {
      status: 400,
    });
  }
  for (const bad of [null, [], false])
    assert.throws(() => parseReturn(bad), { status: 400 });
});

test("local returns are explicitly transient and repeated submissions are idempotent", async () => {
  const store = createReturnStore({ NODE_ENV: "development" });
  const submission = parseReturn(input());
  const first = await store.submit(submission);
  assert.equal(first.localDevelopment, true);
  assert.deepEqual(await store.submit(submission), first);
  await assert.rejects(
    store.submit({
      ...submission,
      fields: {
        ...submission.fields,
        description: "An entirely different return request description.",
      },
    }),
    { status: 409 },
  );
  store.close();
  await assert.rejects(store.submit(submission), { status: 503 });
});

test("deployed returns create private Cosmos records, retry conflicts safely, and fail closed without local fallback", async () => {
  const documents = new Map<string, ReturnDocument>();
  let fail = false;
  let connections = 0;
  let disposed = 0;
  const connect = (() => {
    connections++;
    return {
      client: {
        dispose() {
          disposed++;
        },
      },
      container: {
        items: {
          async create(document: ReturnDocument) {
            if (fail)
              throw Object.assign(
                new Error("private email or credential must not be logged"),
                { code: 403 },
              );
            if (documents.has(document.id)) throw { code: 409 };
            documents.set(document.id, document);
          },
        },
        item(id: string, partition: string) {
          assert.equal(partition, id);
          return {
            async read() {
              return { resource: documents.get(id) };
            },
          };
        },
      },
    };
  }) as unknown as typeof createCosmosConnection;
  const messages: string[] = [];
  const store = createReturnStore(production, connect, (message) => {
    messages.push(message);
  });
  const submission = parseReturn(input());
  const receipt = await store.submit(submission);
  assert.equal(receipt.localDevelopment, false);
  assert.deepEqual(await store.submit(submission), receipt);
  assert.equal(documents.size, 1);
  assert.deepEqual(Object.keys(receipt).sort(), [
    "localDevelopment",
    "reference",
    "status",
  ]);
  await assert.rejects(
    store.submit({
      ...submission,
      fields: { ...submission.fields, item: "Different item" },
    }),
    { status: 409 },
  );
  assert.equal(
    documents.get(`return:${submission.requestId}`)?.item,
    "Printed planter",
  );
  fail = true;
  await assert.rejects(store.submit(parseReturn(input())), { status: 503 });
  assert.match(messages[0], /phase=write.*HTTP 403/);
  assert.ok(!messages[0].includes("private email"));
  assert.equal(disposed, 1);
  fail = false;
  await store.submit(parseReturn(input()));
  assert.equal(connections, 2);
  store.close();
  const unconfigured = createReturnStore(
    { NODE_ENV: "production" },
    connect,
    () => {},
  );
  await assert.rejects(unconfigured.submit(submission), { status: 503 });
  assert.equal(connections, 2);
  unconfigured.close();
});

test("guest return API enforces security, does not expose records and returns a receipt only after saving", async () => {
  const store = createReturnStore({ NODE_ENV: "development" });
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), {
      returnStore: store,
      returnLimiter: checkoutLimiter({ limit: 4 }),
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/returns`;
  const submission = input();
  const post = (body: unknown = submission, headers = {}) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(url)).status, 405);
    assert.equal(
      (await post(submission, { Origin: "https://evil.example" })).status,
      403,
    );
    assert.equal(
      (await post(submission, { "Content-Type": "text/plain" })).status,
      415,
    );
    assert.equal((await post({ ...submission, consent: false })).status, 400);
    const response = await post();
    assert.equal(response.status, 201);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!response.headers.has("access-control-allow-origin"));
    const receipt = await response.json();
    assert.equal(receipt.reference, `RMA-${submission.requestId}`);
    assert.ok(!JSON.stringify(receipt).includes(submission.email.trim()));
    assert.deepEqual(await (await post()).json(), receipt);
    const throttled = await post();
    assert.equal(throttled.status, 429);
    assert.ok(Number(throttled.headers.get("retry-after")) > 0);
  } finally {
    store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
