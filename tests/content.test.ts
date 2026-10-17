import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { emptyContent } from "../src/content.ts";
import {
  createContentSource,
  parseContent,
  isLocalDevelopment,
} from "../server/content.ts";
import type { ContentSource } from "../server/content.ts";
import type { createCosmosConnection } from "../server/cosmos.ts";
import { createPaymentHandler, sandboxSettings } from "../server/payfast.ts";

const records = JSON.parse(
  readFileSync(
    new URL("../data/cosmos-seed/items.json", import.meta.url),
    "utf8",
  ),
);
const production = {
  NODE_ENV: "production",
  COSMOS_ENDPOINT: "https://example.documents.azure.com",
  COSMOS_DATABASE: "store",
  COSMOS_CONTAINER: "Items",
};

test("the seed documents become validated public content, with integer-cent prices authoritative", () => {
  const content = parseContent(records);
  assert.equal(content.products.length, 8);
  assert.equal(content.categories.length, 4);
  assert.equal(content.faqs.length, 5);
  assert.equal(content.services.length, 3);
  assert.equal(content.processSteps.length, 3);
  assert.equal(content.products[0].price, 189);
  const changed = {
    ...records[0],
    price: 1,
    priceCents: 32100,
    privateNote: "secret",
  };
  const sanitized = parseContent([
    changed,
    { EntityType: "Transaction", customerEmail: "private@example.com" },
  ]);
  assert.equal(sanitized.products[0].price, 321);
  assert.ok(!JSON.stringify(sanitized).includes("secret"));
  for (const patch of [
    { priceCents: -1 },
    { priceCents: 1.5 },
    { shape: "arbitrary" },
    { color: "url(https://evil.example)" },
    { productId: "1" },
  ]) {
    assert.equal(
      parseContent([{ ...records[0], ...patch }]).products.length,
      0,
    );
  }
  assert.equal(
    parseContent([records[0], { ...records[0], id: "duplicate" }]).products
      .length,
    0,
  );
});

test("only local development loads seed data; deployed missing configuration stays empty", async () => {
  const local = createContentSource({ NODE_ENV: "development" });
  assert.equal((await local.get()).content.products.length, 8);
  local.close();
  for (const env of [
    {},
    { NODE_ENV: "production" },
    { NODE_ENV: "development", WEBSITE_SITE_NAME: "app" },
    { HOST: "0.0.0.0" },
  ]) {
    assert.equal(isLocalDevelopment(env), false);
    const source = createContentSource(env, undefined, () => {});
    const result = await source.get();
    assert.equal(result.available, false);
    assert.deepEqual(result.content, emptyContent());
    source.close();
  }
});

test("Cosmos empty results, failures and recovery never retain or substitute local data", async () => {
  let rows: unknown[] = [];
  let fail = false;
  let calls = 0;
  let disposed = 0;
  const messages: string[] = [];
  const connect = (() => ({
    client: {
      dispose() {
        disposed++;
      },
    },
    container: {
      items: {
        query(sql: string) {
          assert.match(sql, /TOP 1000/);
          assert.match(sql, /WHERE c\["EntityType"\] IN/);
          return {
            fetchAll: async () => {
              calls++;
              if (fail)
                throw Object.assign(new Error("private provider diagnostic"), {
                  code: 403,
                });
              return { resources: rows };
            },
          };
        },
      },
    },
  })) as unknown as typeof createCosmosConnection;
  const source = createContentSource(production, connect, (message) => {
    messages.push(message);
  });
  assert.deepEqual((await source.get()).content, emptyContent());
  rows = [records[0]];
  assert.equal((await source.get()).content.products.length, 1);
  fail = true;
  const offline = await source.get();
  assert.equal(offline.available, false);
  assert.deepEqual(offline.content, emptyContent());
  assert.equal(disposed, 1);
  assert.ok(
    messages.some((message) =>
      /phase=query reason=cosmos-access-forbidden HTTP 403/.test(message),
    ),
  );
  assert.ok(!messages.join("\n").includes("private provider diagnostic"));
  fail = false;
  assert.equal((await source.get()).content.products.length, 1);
  rows = [];
  assert.deepEqual((await source.get()).content, emptyContent());
  assert.equal(calls, 5);
  source.close();
  assert.equal((await source.get()).available, false);
});

test("content API and checkout share the current server catalogue; outages cannot use local prices", async () => {
  let result = {
    available: true,
    content: parseContent([{ ...records[0], priceCents: 32100 }]),
  };
  const source: ContentSource = { get: async () => result, close() {} };
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), { contentSource: source }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const checkout = () =>
    fetch(base + "/api/payment/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Test",
        lastName: "Buyer",
        email: "test@example.com",
        productIds: [1],
        amount: "0.01",
      }),
    });
  try {
    const response = await fetch(base + "/api/content");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).products[0].price, 321);
    assert.equal((await (await checkout()).json()).fields.amount, "321.00");
    result = { available: true, content: emptyContent() };
    assert.equal((await checkout()).status, 400);
    result = { available: false, content: emptyContent() };
    assert.equal((await checkout()).status, 503);
    const unavailable = await fetch(base + "/api/content");
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), emptyContent());
    assert.equal(
      (await fetch(base + "/api/content", { method: "POST" })).status,
      405,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("production frontend bundles contain no local product or FAQ seed data", () => {
  for (const filename of readdirSync(
    new URL("../dist/assets/", import.meta.url),
  ).filter((name) => name.endsWith(".js"))) {
    const bundle = readFileSync(
      new URL(`../dist/assets/${filename}`, import.meta.url),
      "utf8",
    );
    assert.ok(!bundle.includes("Geometric Planter"));
    assert.ok(
      !bundle.includes("Can I request a custom print without a model?"),
    );
  }
});
