import { fileURLToPath } from "node:url";
import { createAppServer } from "./app.ts";
import { sandboxSettings } from "./payfast.ts";

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3001);
const origin = process.env.APP_ORIGIN
  ? new URL(process.env.APP_ORIGIN)
  : undefined;
if (
  origin &&
  (origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash)
)
  throw new Error(
    "APP_ORIGIN must be an HTTPS origin with no path or credentials.",
  );
if (!["127.0.0.1", "localhost", "::1"].includes(host) && !origin)
  throw new Error(
    "Set an HTTPS APP_ORIGIN before binding to a public interface.",
  );
const server = createAppServer(
  fileURLToPath(new URL("../dist/", import.meta.url)),
  sandboxSettings(process.env),
  {
    httpsOnly: Boolean(origin) || process.env.SECURITY_HTTPS_ONLY === "true",
    allowedHost: origin?.hostname,
  },
);
server.listen(port, host, () =>
  console.log(`Sandbox site running at http://${host}:${port}`),
);
