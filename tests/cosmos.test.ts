import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cosmosSettings,
  createCosmosConnection,
  initializeCosmos,
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

test("the production entry point rejects missing settings and developer credentials before listening", () => {
  for (const extra of [{}, { ...config, COSMOS_AUTH_MODE: "azure-cli" }]) {
    const result = spawnSync(process.execPath, ["server/start.ts"], {
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
      },
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /required in deployment|system-assigned managed identity/,
    );
    assert.ok(!result.stdout.includes("site running"));
  }
});

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

test("startup verifies access before serving and disposes failed clients without leaking errors", async () => {
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
  fake.container.read = async () => {
    throw new Error("private diagnostic");
  };
  await assert.rejects(
    initializeCosmos(cosmosSettings(config), connect),
    (error: Error) => {
      assert.match(error.message, /Cosmos startup check failed/);
      assert.ok(!error.message.includes("private diagnostic"));
      return true;
    },
  );
  assert.equal(disposals, 1);
});
