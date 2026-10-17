import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
import { once } from "node:events";
import { createPaymentHandler, sandboxSettings } from "../server/payfast.ts";
import { checkoutLimiter } from "../server/security.ts";
import { localContent } from "../server/local-content.ts";

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { port: address.port, url: `http://127.0.0.1:${address.port}` };
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function raw(port: number, request: string) {
  return new Promise<string>((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(request));
    let output = "";
    socket.setTimeout(2000, () =>
      socket.destroy(new Error("Test socket timed out")),
    );
    socket.on("data", (chunk) => (output += chunk));
    socket.on("end", () => resolve(output));
    socket.on("error", reject);
  });
}

test("malformed request targets return 400 and the server stays available", async () => {
  const server = createServer(createPaymentHandler(sandboxSettings({})));
  const { port, url } = await listen(server);
  try {
    for (const target of ["//[", "http://["]) {
      const response = await raw(
        port,
        `GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`,
      );
      assert.match(response, /HTTP\/1\.1 400/);
      assert.equal((await fetch(url + "/api/payment/config")).status, 200);
    }
  } finally {
    await close(server);
  }
});

test("aborted and oversized chunked request bodies do not crash the server", async () => {
  const server = createServer(createPaymentHandler(sandboxSettings({})));
  const { port, url } = await listen(server);
  try {
    await new Promise<void>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(
          `POST /api/payment/checkout HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{`,
          () => socket.destroy(),
        );
      });
      socket.on("close", () => resolve());
      socket.on("error", reject);
    });
    assert.equal((await fetch(url + "/api/payment/config")).status, 200);
    const response = await raw(
      port,
      `POST /api/payment/checkout HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n4300\r\n${" ".repeat(0x4300)}\r\n0\r\n\r\n`,
    );
    assert.match(response, /HTTP\/1\.1 413/);
    assert.equal((await fetch(url + "/api/payment/config")).status, 200);
  } finally {
    await close(server);
  }
});

test("rate limiter expires, caps tracking entries, and enforces a global limit", () => {
  let now = 0;
  const limit = checkoutLimiter({
    limit: 2,
    globalLimit: 3,
    maxEntries: 2,
    now: () => now,
  });
  assert.equal(limit("a"), 0);
  assert.equal(limit("a"), 0);
  assert.equal(limit("a"), 60);
  assert.equal(limit("b"), 0);
  assert.equal(limit("c"), 60);
  now = 60_000;
  assert.equal(limit("c"), 0);
  const bounded = checkoutLimiter({
    limit: 10,
    globalLimit: 100,
    maxEntries: 1,
    now: () => now,
  });
  assert.equal(bounded("a"), 0);
  assert.equal(bounded("b"), 60);
  now += 60_000;
  assert.equal(bounded("b"), 0);
});

test("HTTP rate limiting cannot be bypassed by spoofed forwarded addresses", async () => {
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), {
      contentSource: {
        get: async () => ({ available: true, content: localContent }),
        close() {},
      },
      limiter: checkoutLimiter({ limit: 1 }),
    }),
  );
  const { url } = await listen(server);
  const body = JSON.stringify({
    firstName: "Test",
    lastName: "Buyer",
    email: "test@example.com",
    productIds: [1],
  });
  try {
    const first = await fetch(url + "/api/payment/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.1",
      },
      body,
    });
    assert.equal(first.status, 200);
    const second = await fetch(url + "/api/payment/checkout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.2",
      },
      body,
    });
    assert.equal(second.status, 429);
    assert.equal(second.headers.get("retry-after"), "60");
  } finally {
    await close(server);
  }
});

test("cross-site checkout requests are rejected without permissive CORS", async () => {
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), {
      contentSource: {
        get: async () => ({ available: true, content: localContent }),
        close() {},
      },
    }),
  );
  const { url } = await listen(server);
  const body = JSON.stringify({
    firstName: "Test",
    lastName: "Buyer",
    email: "test@example.com",
    productIds: [1],
  });
  try {
    for (const headers of [
      { Origin: "https://evil.example" },
      { "Sec-Fetch-Site": "cross-site" },
    ] as Record<string, string>[]) {
      const response = await fetch(url + "/api/payment/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get("access-control-allow-origin"), null);
    }
    assert.equal(
      (
        await fetch(url + "/api/payment/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: url },
          body,
        })
      ).status,
      200,
    );
  } finally {
    await close(server);
  }
});

test("unfinished checkout bodies time out and do not leave the server unavailable", async () => {
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), { bodyTimeoutMs: 30 }),
  );
  const { port, url } = await listen(server);
  try {
    const response = await raw(
      port,
      `POST /api/payment/checkout HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\nContent-Length: 100\r\nConnection: close\r\n\r\n{`,
    );
    assert.match(response, /HTTP\/1\.1 408/);
    assert.equal((await fetch(url + "/api/payment/config")).status, 200);
  } finally {
    await close(server);
  }
});

test("production policy blocks framing and inline scripts while allowing sandbox forms and redirects", async () => {
  const server = createServer(
    createPaymentHandler(sandboxSettings({}), { httpsOnly: true }),
  );
  const { url } = await listen(server);
  try {
    const response = await fetch(url + "/api/payment/config");
    const csp = response.headers.get("content-security-policy") || "";
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /script-src 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic';/);
    assert.equal(csp.includes("unsafe-inline"), false);
    assert.match(
      csp,
      /form-action 'self' https:\/\/sandbox.payfast.co.za https:\/\/qckruger.github.io/,
    );
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.equal(
      response.headers.get("strict-transport-security"),
      "max-age=31536000",
    );
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  } finally {
    await close(server);
  }
});
