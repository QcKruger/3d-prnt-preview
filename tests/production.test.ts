import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, sep } from "node:path";
import { once } from "node:events";
import { connect } from "node:net";
import { createAppServer } from "../server/app.ts";
import { sandboxSettings } from "../server/payfast.ts";
import { NONCE_PLACEHOLDER } from "../server/html.ts";
import { createServer } from "node:http";
import { createPaymentHandler } from "../server/payfast.ts";
import { checkoutLimiter } from "../server/security.ts";

test("built server serves only approved assets with fresh nonces and blocks private files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "3d-prnt-security-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(
    join(directory, "index.html"),
    `<!doctype html><script nonce="${NONCE_PLACEHOLDER}" src="/assets/app.js"></script>`,
  );
  writeFileSync(join(directory, "assets", "app.js"), 'console.log("fixture")');
  writeFileSync(join(directory, ".env"), "SHOULD_NOT_BE_SERVED");
  writeFileSync(join(directory, "private.js"), "SHOULD_NOT_BE_SERVED");
  writeFileSync(
    join(directory, "assets", "app.js.map"),
    "SHOULD_NOT_BE_SERVED",
  );
  const server = createAppServer(directory, sandboxSettings({}));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = await fetch(base + "/");
    const policy = first.headers.get("content-security-policy")!;
    const nonce = policy.match(/'nonce-([^']+)'/)![1];
    assert.ok((await first.text()).includes(`nonce="${nonce}"`));
    const second = await fetch(base + "/");
    assert.notEqual(second.headers.get("content-security-policy"), policy);
    for (const path of [
      "/.env",
      "/.git/config",
      "/private.js",
      "/server/start.ts",
      "/assets/app.js.map",
      "/%2eenv",
      "/assets/%2e%2e%5c.env",
      "/assets/app.js%00.png",
    ]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 404, path);
      assert.ok(!(await response.text()).includes("SHOULD_NOT_BE_SERVED"));
    }
    assert.equal((await fetch(base + "/assets/app.js")).status, 200);
    assert.equal((await fetch(base + "/", { method: "HEAD" })).status, 200);
    const rawRequest = (method: string, host: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(address.port, "127.0.0.1", () =>
          socket.write(
            `${method} / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`,
          ),
        );
        let output = "";
        socket.on("data", (chunk) => (output += chunk));
        socket.on("end", () => resolve(output));
        socket.on("error", reject);
      });
    assert.match(await rawRequest("GET", "attacker.example"), /HTTP\/1\.1 403/);
    assert.match(
      await rawRequest("TRACE", `127.0.0.1:${address.port}`),
      /HTTP\/1\.1 405/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const verified = resolve(directory);
    if (!verified.startsWith(resolve(tmpdir()) + sep + "3d-prnt-security-"))
      throw new Error("Unexpected test directory.");
    rmSync(verified, { recursive: true, force: true });
  }
});

test("request throttling also covers read endpoints", async () => {
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), {
      requestLimiter: checkoutLimiter({ limit: 1 }),
    }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const base = `http://127.0.0.1:${address.port}/api/payment/config`;
    assert.equal((await fetch(base)).status, 200);
    const denied = await fetch(base);
    assert.equal(denied.status, 429);
    assert.ok(denied.headers.has("retry-after"));
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("connection budget drops excess sockets and releases capacity on close", async () => {
  const { hardenServer } = await import("../server/security.ts");
  const server = createServer((_request, response) => response.end("ok"));
  hardenServer(server, { maxPerAddress: 1 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const first = connect(address.port, "127.0.0.1");
  await once(first, "connect");
  const second = connect(address.port, "127.0.0.1");
  second.resume();
  try {
    await Promise.race([
      once(second, "close"),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Socket was not dropped")), 1000),
      ),
    ]);
  } finally {
    first.destroy();
    second.destroy();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
