import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  cosmosSettings,
  createCosmosConnection,
  initializeCosmos,
  initializeCosmosFromEnvironment,
} from "../server/cosmos.ts";

const config = {
  COSMOS_ENDPOINT: "https://example-account.documents.azure.com/",
  COSMOS_DATABASE: "store",
  COSMOS_CONTAINER: "entities",
};

test("local preview is optional, deployed data configuration is mandatory", () => {
  assert.equal(cosmosSettings({}), undefined);
  assert.equal(
    cosmosSettings({
      ...config,
      COSMOS_ENDPOINT: "https://3dprntdb.documents.azure.com:443/",
    })?.endpoint,
    "https://3dprntdb.documents.azure.com",
  );
  for (const env of [
    { NODE_ENV: "production" },
    { WEBSITE_SITE_NAME: "app" },
    { CONTAINER_APP_NAME: "app" },
    { HOST: "0.0.0.0" },
  ]) {
    assert.throws(() => cosmosSettings(env), /required in deployment/);
    assert.equal(
      cosmosSettings({ ...config, ...env })?.authMode,
      "managed-identity",
    );
    assert.throws(
      () =>
        cosmosSettings({ ...config, ...env, COSMOS_AUTH_MODE: "azure-cli" }),
      /system-assigned/,
    );
  }
  assert.equal(cosmosSettings({ NODE_ENV: "production" }, false), undefined);
  assert.throws(() => cosmosSettings({ COSMOS_DATABASE: "store" }), /together/);
});

test(
  "production serves the site and logs disabled data access when Cosmos settings are missing or invalid",
  { timeout: 20_000 },
  async () => {
    for (const extra of [{}, { ...config, COSMOS_AUTH_MODE: "azure-cli" }]) {
      const probe = createServer();
      probe.listen(0, "127.0.0.1");
      await once(probe, "listening");
      const address = probe.address();
      assert.ok(address && typeof address !== "string");
      const port = address.port;
      await new Promise<void>((resolve) => probe.close(() => resolve()));
      const child = spawn(process.execPath, ["server/start.ts"], {
        cwd: new URL("../", import.meta.url),
        env: {
          ...process.env,
          COSMOS_ENDPOINT: "",
          COSMOS_DATABASE: "",
          COSMOS_CONTAINER: "",
          COSMOS_AUTH_MODE: "managed-identity",
          ...extra,
          NODE_ENV: "production",
          HOST: "127.0.0.1",
          APP_ORIGIN: "",
          PORT: String(port),
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let errors = "";
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      try {
        await Promise.race([
          once(child.stdout, "data"),
          once(child, "exit").then(() => {
            throw new Error("Site exited during Cosmos failure.");
          }),
        ]);
        const response = await fetch(
          `http://127.0.0.1:${port}/api/payment/config`,
        );
        assert.equal(response.status, 200);
        assert.equal((await response.json()).mode, "sandbox");
        const contentResponse = await fetch(
          `http://127.0.0.1:${port}/api/content`,
        );
        assert.equal(contentResponse.status, 503);
        const content = await contentResponse.json();
        assert.deepEqual(content.products, []);
        if (!errors.includes("reason=invalid-server-configuration"))
          await once(child.stderr, "data");
        assert.match(
          errors,
          /phase=configuration reason=invalid-server-configuration/,
        );
        assert.match(errors, /Site remains running/);
        assert.equal(child.exitCode, null);
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, "exit");
          child.kill();
          await exited;
        }
      }
    }
  },
);

test("connection is keyless, server-only, and local CLI authentication is explicit", () => {
  for (const env of [
    { COSMOS_KEY: "blocked" },
    { AZURE_COSMOS_CONNECTION_STRING: "blocked" },
    { VITE_COSMOS_ENDPOINT: config.COSMOS_ENDPOINT },
    { VITE_AZURE_CLIENT_SECRET: "blocked" },
    { ...config, COSMOS_AUTH_MODE: "default" },
  ])
    assert.throws(() => cosmosSettings(env));
  assert.equal(
    cosmosSettings({ ...config, COSMOS_AUTH_MODE: "azure-cli" })?.authMode,
    "azure-cli",
  );
  // Construct both real SDK clients without obtaining tokens or touching data.
  for (const authMode of ["managed-identity", "azure-cli"]) {
    const settings = cosmosSettings({ ...config, COSMOS_AUTH_MODE: authMode })!;
    const connection = createCosmosConnection(settings);
    assert.equal(connection.container.id, "entities");
    connection.client.dispose();
  }
});

test("rejects endpoints that could send identity tokens to an arbitrary host", () => {
  for (const endpoint of [
    "http://example-account.documents.azure.com",
    "https://attacker.example",
    "https://example-account.documents.azure.com.attacker.example",
    "https://user:password@example-account.documents.azure.com",
    "https://example-account.documents.azure.com/dbs/store",
    "https://example-account.documents.azure.com?token=value",
  ])
    assert.throws(() =>
      cosmosSettings({ ...config, COSMOS_ENDPOINT: endpoint }),
    );
  assert.throws(() => cosmosSettings({ ...config, COSMOS_CONTAINER: "a/b" }));
});

test("failed Cosmos access logs a safe status, disposes the client and leaves data disabled", async () => {
  let reads = 0;
  let disposals = 0;
  const fake = {
    client: {
      dispose: () => {
        disposals++;
      },
    },
    container: {
      read: async () => {
        reads++;
      },
    },
  };
  // Narrow test doubles exercise startup without a live Azure identity/account.
  const connect = (() => fake) as unknown as typeof createCosmosConnection;
  assert.equal(await initializeCosmos(undefined, connect), undefined);
  assert.equal(reads, 0);
  assert.equal(await initializeCosmos(cosmosSettings(config), connect), fake);
  assert.equal(reads, 1);
  assert.equal(disposals, 0);
  const messages: string[] = [];
  fake.container.read = async () => {
    throw Object.assign(new Error("private diagnostic"), { code: 403 });
  };
  assert.equal(
    await initializeCosmos(cosmosSettings(config), connect, (message) => {
      messages.push(message);
    }),
    undefined,
  );
  assert.match(messages[0], /HTTP 403/);
  assert.match(messages[0], /site remains running/);
  assert.ok(!messages[0].includes("private diagnostic"));
  assert.equal(disposals, 1);
  const brokenFactory = (() => {
    throw new Error("private credential error");
  }) as typeof createCosmosConnection;
  assert.equal(
    await initializeCosmos(cosmosSettings(config), brokenFactory, (message) => {
      messages.push(message);
    }),
    undefined,
  );
  assert.ok(!messages[1].includes("private credential error"));
});

test("invalid Cosmos configuration logs once without using insecure fallback credentials", async () => {
  const messages: string[] = [];
  const result = await initializeCosmosFromEnvironment(
    { ...config, NODE_ENV: "production", COSMOS_AUTH_MODE: "azure-cli" },
    (message) => {
      messages.push(message);
    },
  );
  assert.equal(result, undefined);
  assert.equal(messages.length, 1);
  assert.match(messages[0], /Configuration invalid or incomplete/);
});
