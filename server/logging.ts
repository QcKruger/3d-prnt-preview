import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type CosmosPhase = "configuration" | "client" | "query" | "validation";

// Inspect provider text only to classify it. Never copy tokens, headers, document
// bodies, URLs with credentials, or arbitrary error messages into the log.
export function describeCosmosFailure(
  error: unknown,
  phase: CosmosPhase,
): string {
  const e =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const cause =
    e.cause && typeof e.cause === "object"
      ? (e.cause as Record<string, unknown>)
      : {};
  const message = typeof e.message === "string" ? e.message : "";
  const code = e.code ?? e.statusCode ?? e.status;
  const status =
    typeof code === "number" &&
    Number.isInteger(code) &&
    code >= 100 &&
    code <= 599
      ? code
      : undefined;
  const networkCode = [
    "ENOTFOUND",
    "EAI_AGAIN",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "CERT_HAS_EXPIRED",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  ].find((value) => value === code || value === cause.code);
  let reason = "unclassified-provider-error";
  let action =
    "Use the activity ID and timestamp to inspect Cosmos diagnostics.";
  if (phase === "configuration") {
    reason = "invalid-server-configuration";
    action =
      "Check COSMOS_ENDPOINT, COSMOS_DATABASE, COSMOS_CONTAINER and COSMOS_AUTH_MODE; use managed-identity and no account keys or VITE_ Azure settings.";
  } else if (
    /firewall|client ip|public network|virtual network/i.test(message)
  ) {
    reason = "network-access-denied";
    action =
      "Check Cosmos public network settings and all App Service outbound IP addresses.";
  } else if (/syntax|SC1001|SC2001|SC1002/i.test(message)) {
    reason = "query-syntax-error";
    action = "Check the server Cosmos SQL query and reserved property names.";
  } else if (
    /ManagedIdentityCredential|CredentialUnavailable|AuthenticationRequired/i.test(
      String(e.name),
    ) ||
    /managed identity|identity endpoint|token acquisition/i.test(message)
  ) {
    reason = "managed-identity-authentication-failed";
    action =
      "Enable the App Service system-assigned identity and check its token endpoint availability.";
  } else if (status === 403) {
    reason = "cosmos-access-forbidden";
    action =
      "Check the runtime system identity's Cosmos data role, assignment scope and Cosmos firewall; Azure resource Contributor is insufficient.";
  } else if (status === 401) {
    reason = "authentication-rejected";
    action = "Check the runtime managed identity and Cosmos account tenant.";
  } else if (status === 404) {
    reason = "database-or-container-not-found";
    action =
      "Check the account endpoint and case-sensitive database/container names.";
  } else if (status === 429) {
    reason = "cosmos-throttled";
    action = "Check provisioned throughput and Cosmos request metrics.";
  } else if (networkCode) {
    reason = "network-or-tls-failure";
    action =
      "Check DNS, outbound connectivity, private endpoint routing and TLS.";
  } else if (
    e.name === "AbortError" ||
    e.name === "TimeoutError" ||
    status === 408 ||
    status === 504
  ) {
    reason = "cosmos-request-timeout";
    action =
      "Check Cosmos latency and App Service networking; the content request has an 8-second deadline.";
  } else if (status === 400) {
    reason = "cosmos-bad-request";
    action =
      "Check the SQL query and container configuration using the activity ID.";
  }
  const details = [`phase=${phase}`, `reason=${reason}`];
  if (status) details.push(`HTTP ${status}`);
  if (networkCode) details.push(`networkCode=${networkCode}`);
  const headers =
    e.headers && typeof e.headers === "object"
      ? (e.headers as Record<string, unknown>)
      : {};
  const substatus = e.substatus ?? headers["x-ms-substatus"];
  if (/^\d{1,6}$/.test(String(substatus)))
    details.push(`substatus=${substatus}`);
  const activityId = e.activityId ?? headers["x-ms-activity-id"];
  if (typeof activityId === "string" && /^[a-f0-9-]{36}$/i.test(activityId))
    details.push(`activityId=${activityId}`);
  const syntaxCode = message.match(/\bSC\d{4}\b/);
  if (syntaxCode) details.push(`queryError=${syntaxCode[0]}`);
  return `${details.join(" ")}. ${action}`;
}

// Callers supply controlled messages, never raw provider errors or credentials.
export async function logCosmosFailure(message: string): Promise<void> {
  const entry = `${new Date().toISOString()} [Cosmos] ${message}`;
  console.error(entry);
  // IISNode stdout capture is disabled. Keep an operational log outside wwwroot
  // on Azure's writable home volume instead of inside the deployment package.
  if (process.env.WEBSITE_SITE_NAME && process.env.HOME) {
    try {
      const directory = join(process.env.HOME, "LogFiles", "3dprnt");
      await mkdir(directory, { recursive: true });
      await appendFile(join(directory, "cosmos.log"), entry + "\n", "utf8");
    } catch {
      console.error("[Cosmos] Could not write the Azure operational log.");
    }
  }
}
