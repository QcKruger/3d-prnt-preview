import { CosmosClient } from "@azure/cosmos";
import { AzureCliCredential, ManagedIdentityCredential } from "@azure/identity";

type Environment = Record<string, string | undefined>;

export interface CosmosSettings {
  endpoint: string;
  database: string;
  container: string;
  authMode: "managed-identity" | "azure-cli";
}

export function cosmosSettings(
  env: Environment,
  runtime = true,
): CosmosSettings | undefined {
  // A deployed process must never silently become a disconnected local preview.
  const deployed =
    runtime &&
    (env.NODE_ENV === "production" ||
      Boolean(
        env.WEBSITE_INSTANCE_ID ||
        env.WEBSITE_SITE_NAME ||
        env.CONTAINER_APP_NAME ||
        env.IDENTITY_ENDPOINT ||
        env.MSI_ENDPOINT ||
        (env.HOST && !["localhost", "127.0.0.1", "::1"].includes(env.HOST)),
      ));
  for (const [name, value] of Object.entries(env)) {
    if (name.startsWith("VITE_") && /COSMOS|AZURE|MANAGED_IDENTITY/i.test(name))
      throw new Error(
        "Azure data settings must be server-only, without a VITE_ prefix.",
      );
    if (
      value &&
      /^(?:COSMOS|AZURE_COSMOS).*?(?:KEY|CONNECTION_STRING|TOKEN|SECRET)$/i.test(
        name,
      )
    )
      throw new Error(
        "Cosmos account keys and connection strings are not supported. Use identity authentication.",
      );
  }
  const endpoint = env.COSMOS_ENDPOINT?.trim();
  const database = env.COSMOS_DATABASE?.trim();
  const container = env.COSMOS_CONTAINER?.trim();
  const authMode = env.COSMOS_AUTH_MODE?.trim() || "managed-identity";
  if (authMode !== "managed-identity" && authMode !== "azure-cli")
    throw new Error("COSMOS_AUTH_MODE must be managed-identity or azure-cli.");
  if (deployed && authMode !== "managed-identity")
    throw new Error(
      "Deployed data access requires a system-assigned managed identity.",
    );
  if (!endpoint && !database && !container && !deployed) return undefined;
  if (!endpoint || !database || !container)
    throw new Error(
      "Set COSMOS_ENDPOINT, COSMOS_DATABASE and COSMOS_CONTAINER together. They are required in deployment.",
    );
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("Invalid COSMOS_ENDPOINT.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !/^[a-z0-9][a-z0-9-]*\.documents\.azure\.com$/i.test(url.hostname)
  )
    throw new Error(
      "COSMOS_ENDPOINT must be an Azure public-cloud NoSQL HTTPS account endpoint.",
    );
  for (const id of [database, container]) {
    if (
      /[\\/?#\u0000-\u001f\u007f]/.test(id) ||
      id.endsWith(" ") ||
      Buffer.byteLength(id) > 255
    )
      throw new Error("Invalid Cosmos database or container name.");
  }
  return { endpoint: url.origin, database, container, authMode };
}

export function createCosmosConnection(settings: CosmosSettings) {
  // No DefaultAzureCredential chain: deployed access cannot fall back to a
  // developer login, service principal secret, account key or user-assigned ID.
  const credential =
    settings.authMode === "azure-cli"
      ? new AzureCliCredential()
      : new ManagedIdentityCredential();
  const client = new CosmosClient({
    endpoint: settings.endpoint,
    aadCredentials: credential,
    connectionPolicy: { requestTimeout: 10_000 },
  });
  const container = client
    .database(settings.database)
    .container(settings.container);
  return { client, container };
}

export async function initializeCosmos(
  settings: CosmosSettings | undefined,
  connect = createCosmosConnection,
) {
  if (!settings) return undefined;
  const connection = connect(settings);
  try {
    // Verify the identity, permissions, network and existing container before
    // accepting traffic. Provisioning resources is not a runtime permission.
    await connection.container.read({
      abortSignal: AbortSignal.timeout(20_000),
    });
    return connection;
  } catch {
    connection.client.dispose();
    throw new Error(
      "Cosmos startup check failed. Check the host's system-assigned identity, Cosmos data role, network access and database/container settings.",
    );
  }
}
