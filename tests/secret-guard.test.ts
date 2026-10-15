import { test } from "node:test";
import assert from "node:assert/strict";
import { secretFindings } from "../scripts/check-secrets.ts";

test("secret guard rejects tracked environment files, tokens, keys and literal credential assignments", () => {
  assert.ok(secretFindings(".env", "").length);
  assert.ok(secretFindings("folder/.env.production", "").length);
  assert.ok(
    secretFindings(
      "file.ts",
      'const token="' + "gh" + "p_" + "A".repeat(36) + '"',
    ).length,
  );
  assert.ok(
    secretFindings("file.pem", "-----BEGIN " + "PRIVATE KEY-----").length,
  );
  assert.ok(
    secretFindings(
      "config.ts",
      'PAYFAST_SANDBOX_PASSPHRASE="' + "unconfigured-example-secret" + '"',
    ).length,
  );
  assert.deepEqual(
    secretFindings(
      ".env.example",
      "PAYFAST_SANDBOX_PASSPHRASE=YOUR_SANDBOX_PASSPHRASE",
    ),
    [],
  );
});
