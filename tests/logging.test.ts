import { test } from "node:test";
import assert from "node:assert/strict";
import { describeCosmosFailure } from "../server/logging.ts";

test("Cosmos diagnostics distinguish actionable failures without copying provider secrets", () => {
  const activityId = "12345678-1234-1234-1234-123456789abc";
  const output = describeCosmosFailure(
    {
      code: 403,
      message: "Request blocked by firewall Bearer secret-token",
      headers: {
        "x-ms-substatus": "5301",
        "x-ms-activity-id": activityId,
        authorization: "secret-token",
      },
    },
    "query",
  );
  assert.match(output, /reason=network-access-denied HTTP 403/);
  assert.match(output, /substatus=5301/);
  assert.ok(output.includes(activityId));
  assert.ok(!output.includes("secret-token"));
  assert.match(
    describeCosmosFailure(
      { code: 400, message: "Syntax error SC1001 near secret-token" },
      "query",
    ),
    /reason=query-syntax-error HTTP 400.*queryError=SC1001/,
  );
  assert.match(
    describeCosmosFailure({ code: 404 }, "query"),
    /database-or-container-not-found/,
  );
  assert.match(
    describeCosmosFailure({ name: "CredentialUnavailableError" }, "query"),
    /managed-identity-authentication-failed/,
  );
  assert.match(
    describeCosmosFailure({ cause: { code: "ENOTFOUND" } }, "query"),
    /network-or-tls-failure.*networkCode=ENOTFOUND/,
  );
  assert.match(
    describeCosmosFailure({ name: "TimeoutError" }, "query"),
    /cosmos-request-timeout/,
  );
  assert.match(
    describeCosmosFailure(new Error("secret-value"), "configuration"),
    /invalid-server-configuration/,
  );
  assert.ok(
    !describeCosmosFailure(new Error("secret-value"), "configuration").includes(
      "secret-value",
    ),
  );
});
