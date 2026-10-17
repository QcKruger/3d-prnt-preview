# Azure deployment and keyless Cosmos DB access

The Node backend uses the **hosting resource's system-assigned managed identity** to access an existing Azure Cosmos DB for NoSQL container. The React browser never connects directly to Cosmos. There is no account key, connection string, client secret, user-assigned identity selector or automatic fallback credential chain.

This configures the data connection, not persistence features. The server verifies container metadata at startup; catalogue products remain in source, carts remain in memory, and orders/payment results are not saved. Future data repositories should use `createCosmosConnection` from `server/cosmos.ts` on the server, reusing one client per process. Never expose arbitrary Cosmos queries or item access in a public route: future account endpoints must enforce user ownership independently of the app's identity.

## Hosting requirements

Use an Azure host that runs the Node backend and supports system-assigned managed identity, such as Azure App Service. GitHub Pages cannot run this backend or obtain a managed identity. The configured deployment targets **Windows App Service `3dprntweb` in Azure public cloud, without a staging slot**. Other hosts, sovereign clouds and deployment slots need corresponding infrastructure configuration.

Build with Node.js 24 and dev dependencies installed (`npm ci`, then `npm run build`). On Windows x64, `scripts/package-windows.ps1` packages the approved application files, production dependencies and Node.js 24 executable. `deployment/web.config` routes all requests through IISNode and `iisnode.cjs` starts the TypeScript backend. The server supports IISNode's named-pipe `PORT` as well as normal TCP ports. Do not set a numeric `PORT` manually in Windows App Service. Debugging and IISNode response diagnostics are disabled. Source/runtime folders are blocked by IIS and the Node asset allowlist.

The Windows packaging script includes the Node 24 executable used to build the package. Rebuild/redeploy to update the bundled Node runtime; platform runtime updates alone do not update this bundled executable. The application package excludes `.env` and development credentials. Linux/local deployments can instead use Node.js 24 with `npm start` behind an appropriate reverse proxy.

## GitHub Actions deployment for 3dprntweb

Azure Deployment Center created `.github/workflows/main_3dprntweb.yml` on remote `main`, targeting `3dprntweb` on pushes to `main` and manual runs. Its login step references Azure-created `AZUREAPPSERVICE_CLIENTID_*`, `AZUREAPPSERVICE_TENANTID_*` and `AZUREAPPSERVICE_SUBSCRIPTIONID_*` GitHub secrets. Preserve those references. The duplicate locally prepared workflow and deployment-identity bootstrap script have been removed. No additional `AZURE_CLIENT_ID` repository variable is required for the generated workflow.

The workflow now calls `scripts/package-windows.ps1`, places `web.config` and `iisnode.cjs` at the package root, installs Playwright Chromium for tests, and runs the complete security gate before deploying the ZIP. Azure's generated OIDC secret references are preserved. The independent `security.yml` runs PR and scheduled checks. No staging slot is used, so deployment can briefly interrupt service.

Configured resources:

| Setting              | Value                                       |
| -------------------- | ------------------------------------------- |
| Subscription         | `0075afe9-1dd4-4d5a-aab6-b4375210b0b0`      |
| Tenant               | `1658f04c-929f-4317-a9dc-76d9ccf48b38`      |
| Resource group       | `3D-PRNT`                                   |
| Windows App Service  | `3dprntweb`                                 |
| Cosmos account       | `3dprntdb`                                  |
| Cosmos endpoint      | `https://3dprntdb.documents.azure.com:443/` |
| Database / container | `3dprnt` / `Items`                          |

The Cosmos account is assumed to be in `3D-PRNT`; adjust the setup script's Cosmos resource group if it is elsewhere. Port 443 in the supplied endpoint is the default HTTPS port and is normalized automatically.

Azure Deployment Center manages the deployment identity and its federation. It is separate from the running app's **system-assigned** identity used for Cosmos. Runtime Cosmos permissions and application settings still require the configuration below; the existence of the GitHub workflow does not verify those permissions. Protect `main` with PR reviews and required checks because changes on that branch can deploy using the deployment identity.

The deployment job enables the app's system-assigned identity and sets `WEBSITE_RUN_FROM_PACKAGE=1`, `SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `WEBSITE_NODE_DEFAULT_VERSION=~24`, `NODE_ENV=production`, `HOST=0.0.0.0` and the supplied server-only Cosmos identifiers. It derives `APP_ORIGIN` from the actual default hostname and enables HTTPS-only. Existing PayFast secret settings are preserved; default return/cancel URLs remain the previously requested GitHub Pages destination. If Pages is disabled, update those two server settings to the intended Azure return destination.

The deployment identity must have Website Contributor on the web app for those runtime settings. It is not granted Cosmos role-administration permissions. The workflow prints the app's system-assigned principal ID; an authorised Azure operator must grant that principal Cosmos DB Built-in Data Reader on `/dbs/3dprnt/colls/Items`, using the script below or equivalent native Cosmos role assignment. Without this grant, startup fails closed and the post-deployment API check fails. The Azure CLI session available during implementation could not see the supplied subscription, so this data-role assignment cannot be verified locally.

Create the Cosmos account, database and container separately. This code does not create resources, choose/change a partition key, or migrate data. Database/container names are case-sensitive. Permit the host through Cosmos networking; managed identity supplies authentication, not network connectivity. Prefer private endpoints with App Service VNet integration where available.

## Configure an existing App Service

Sign in with Azure CLI (`az login`) using an account allowed to update the web app's identity/settings and create Cosmos native data-role assignments (`Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments/write`). A normal Azure management-plane Contributor assignment is not itself runtime access to Cosmos documents.

Run this script explicitly with your real resource names; it has not been run automatically:

```powershell
./scripts/configure-azure-identity.ps1 `
  -SubscriptionId 'YOUR_SUBSCRIPTION_GUID' `
  -AppResourceGroup 'YOUR_APP_RESOURCE_GROUP' `
  -AppName 'YOUR_APP_SERVICE' `
  -CosmosResourceGroup 'YOUR_COSMOS_RESOURCE_GROUP' `
  -CosmosAccount 'YOUR_COSMOS_ACCOUNT' `
  -Database 'YOUR_DATABASE' `
  -Container 'YOUR_CONTAINER'
```

The script enables the web app's system-assigned identity, grants **Cosmos DB Built-in Data Reader** at `/dbs/<database>/colls/<container>`, enables HTTPS-only, and sets these server-side App Service environment settings:

| Setting            | Value                           |
| ------------------ | ------------------------------- |
| `NODE_ENV`         | `production`                    |
| `COSMOS_AUTH_MODE` | `managed-identity`              |
| `COSMOS_ENDPOINT`  | Account HTTPS document endpoint |
| `COSMOS_DATABASE`  | Existing database name          |
| `COSMOS_CONTAINER` | Existing container name         |
| `HOST`             | `0.0.0.0`                       |
| `APP_ORIGIN`       | Web app's default HTTPS origin  |

If using a custom domain, set `APP_ORIGIN` to its exact HTTPS origin afterward. Runtime connection settings contain identifiers, not credentials. Do not add `VITE_` prefixes. `AZURE_CLIENT_ID` is not used to select an identity; the managed-identity credential is constructed without an identity selector. Each deployment slot needs its own identity, permissions and appropriate settings; do not assume a slot swap moves the identity.

Reader is enough for the current metadata check and future reads. When implementing writes, use `-DataRole Contributor` to grant **Cosmos DB Built-in Data Contributor** at the same container scope, or define a narrower custom data role for the necessary operations. Re-running with a different role adds that assignment; remove obsolete assignments separately. No resource-group-wide Contributor role is granted to the app.

For an account whose clients have all migrated to identity authentication, add `-DisableKeyAuthentication` to disable key authentication account-wide. This is optional because it affects every client of that account. The application itself never uses keys either way. Existing unrelated settings/credentials and role assignments are not removed by this script; review and remove obsolete ones separately.

Allow data-role propagation, then restart the app. Startup reads the configured container's metadata and refuses to accept traffic if authentication, permissions, networking or the container are unavailable. It does not create or write documents. Diagnostics intentionally omit provider errors/tokens; check the identity principal, native Cosmos data-role scope, resource names and network configuration if startup fails. Deleting/recreating the host or disabling/re-enabling its identity can change the principal; rerun setup and remove obsolete assignments.

## Local development

With no Cosmos settings, `npm run dev` and local `npm start` remain stateless previews. Production (`NODE_ENV=production`), Azure-managed-identity environments and public-interface startup require all three Cosmos identifiers and managed-identity mode. Builds validate supplied settings but do not obtain tokens or connect to Cosmos.

To verify access locally, assign your developer identity a Cosmos native Data Reader role on a development container, run `az login` in the correct tenant, and add the following to your ignored `.env`:

```dotenv
COSMOS_ENDPOINT=https://YOUR_ACCOUNT.documents.azure.com
COSMOS_DATABASE=YOUR_DATABASE
COSMOS_CONTAINER=YOUR_CONTAINER
COSMOS_AUTH_MODE=azure-cli
```

Then run `npm run build` and `npm start`. Only this explicit local mode uses your Azure CLI login; it is rejected by the deployed runtime. `npm run dev` validates configuration but does not initialize a data client because the current UI has no data routes. No emulator or account-key mode is supported.

PayFast remains sandbox-only and uses separate server-side credentials. Managed identity does not replace PayFast's signing passphrase; on App Service it can separately authorize Key Vault references for those secrets.

References: [System-assigned managed identity for JavaScript](https://learn.microsoft.com/en-us/azure/developer/javascript/sdk/authentication/system-assigned-managed-identity), [Cosmos DB native data RBAC and disabling keys](https://learn.microsoft.com/en-us/azure/cosmos-db/how-to-connect-role-based-access-control), [App Service managed identity and deployment slots](https://learn.microsoft.com/en-us/azure/app-service/overview-managed-identity).
