import { fileURLToPath } from "node:url";
import { createAppServer } from "./app.ts";
import { sandboxSettings } from "./payfast.ts";
import { createContentSource } from "./content.ts";
import { listenerTarget } from "./listener.ts";

const host = process.env.HOST || "127.0.0.1";
const port = listenerTarget(process.env.PORT);
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
const paymentSettings = sandboxSettings(process.env);
const contentSource = createContentSource(process.env);
const server = createAppServer(
  fileURLToPath(new URL("../dist/", import.meta.url)),
  paymentSettings,
  {
    httpsOnly: Boolean(origin) || process.env.SECURITY_HTTPS_ONLY === "true",
    allowedHost: origin?.hostname,
    contentSource,
  },
);
server.once("close", () => {
  contentSource.close();
});
const listening = () => {
  console.log("Sandbox site running.");
  void contentSource.get();
};
if (typeof port === "string") server.listen(port, listening);
else server.listen(port, host, listening);
