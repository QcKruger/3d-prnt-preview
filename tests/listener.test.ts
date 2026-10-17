import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:http";
import { once } from "node:events";
import { listenerTarget } from "../server/listener.ts";

test("listener supports TCP ports and the IISNode named pipe", () => {
  assert.equal(listenerTarget(undefined), 3001);
  assert.equal(listenerTarget("8080"), 8080);
  assert.equal(
    listenerTarget("\\\\.\\pipe\\iisnode-example"),
    "\\\\.\\pipe\\iisnode-example",
  );
  for (const invalid of [
    "NaN",
    "0",
    "65536",
    "1.5",
    "not-a-pipe",
    "\\\\.\\pipe\\bad\n",
  ])
    assert.throws(() => listenerTarget(invalid));
});

test(
  "Windows entry point serves the sandbox API over an IISNode-style pipe",
  {
    skip: process.platform !== "win32",
    timeout: 15_000,
  },
  async () => {
    const pipe = `\\\\.\\pipe\\3dprnt-test-${process.pid}-${Date.now()}`;
    const child = spawn(process.execPath, ["server/start.ts"], {
      cwd: new URL("../", import.meta.url),
      env: {
        ...process.env,
        PORT: pipe,
        HOST: "127.0.0.1",
        NODE_ENV: "test",
        APP_ORIGIN: "",
        COSMOS_ENDPOINT: "",
        COSMOS_DATABASE: "",
        COSMOS_CONTAINER: "",
        COSMOS_AUTH_MODE: "managed-identity",
        WEBSITE_INSTANCE_ID: "",
        WEBSITE_SITE_NAME: "",
        IDENTITY_ENDPOINT: "",
        MSI_ENDPOINT: "",
        CONTAINER_APP_NAME: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(() => {
          throw new Error("Pipe server exited before listening.");
        }),
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Pipe server did not start.")),
            10_000,
          );
          timer.unref();
        }),
      ]);
      const body = await new Promise<string>((resolve, reject) => {
        const req = request(
          {
            socketPath: pipe,
            path: "/api/payment/config",
            headers: { Host: "localhost" },
          },
          (response) => {
            assert.equal(response.statusCode, 200);
            let output = "";
            response.on("data", (part) => {
              output += part;
            });
            response.on("end", () => resolve(output));
          },
        );
        req.on("error", reject);
        req.end();
      });
      assert.equal(JSON.parse(body).mode, "sandbox");
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit");
        child.kill();
        await exited;
      }
    }
  },
);
