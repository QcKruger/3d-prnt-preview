import type { Plugin } from "vite";
import type { Server } from "node:http";
import { loadEnv } from "vite";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPaymentHandler, sandboxSettings } from "./payfast.ts";
import {
  errorResponse,
  hardenServer,
  HttpError,
  requestPath,
} from "./security.ts";
import { sendHtml } from "./html.ts";
import { cosmosSettings } from "./cosmos.ts";
import { createContentSource } from "./content.ts";
import type { ContentSource } from "./content.ts";

export function paymentPlugin(): Plugin {
  let handler: ReturnType<typeof createPaymentHandler>;
  let development = false;
  let root = "";
  let output = "";
  let contentSource: ContentSource;
  return {
    name: "payfast-sandbox-api",
    config(_config, environment) {
      development = environment.command === "serve" && !environment.isPreview;
    },
    configResolved(config) {
      root = config.root;
      output = resolve(root, config.build.outDir);
      const env = { ...loadEnv(config.mode, root, ""), ...process.env };
      // Validate server-only configuration at build/dev startup; Cosmos network
      // access is initialized by the deployed Node server, not the build agent.
      cosmosSettings(env, false);
      const origin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN) : undefined;
      contentSource = createContentSource({
        ...env,
        NODE_ENV: development ? "development" : "production",
      });
      handler = createPaymentHandler(sandboxSettings(env), {
        development,
        httpsOnly: env.SECURITY_HTTPS_ONLY === "true",
        allowedHost: origin?.hostname,
        contentSource,
      });
    },
    configureServer(server) {
      server.httpServer?.once("close", () => contentSource.close());
      if (server.httpServer && "headersTimeout" in server.httpServer)
        hardenServer(server.httpServer as Server);
      server.middlewares.use(handler);
      server.middlewares.use(async (request, response, next) => {
        try {
          const path = decodeURIComponent(requestPath(request));
          if (
            /^\/(?:server|tests|scripts|@fs)(?:\/|$)/i.test(path) ||
            /(?:^|\/)\.(?:env|git)(?:[./]|$)/i.test(path) ||
            /^\/(?:package(?:-lock)?\.json|vite\.config\.ts|tsconfig\.json)/i.test(
              path,
            )
          )
            throw new HttpError(404, "Not found.");
          if (path !== "/" && path !== "/index.html") {
            next();
            return;
          }
          if (!["GET", "HEAD"].includes(request.method || ""))
            throw new HttpError(405, "Only GET and HEAD are allowed.");
          if (request.method === "HEAD") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end();
            return;
          }
          const html = await server.transformIndexHtml(
            request.url || "/",
            await readFile(resolve(root, "index.html"), "utf8"),
          );
          sendHtml(response, html);
        } catch (error) {
          errorResponse(request, response, error);
        }
      });
    },
    configurePreviewServer(server) {
      server.httpServer.once("close", () => contentSource.close());
      if ("headersTimeout" in server.httpServer)
        hardenServer(server.httpServer as Server);
      server.middlewares.use(handler);
      server.middlewares.use(async (request, response, next) => {
        try {
          const path = requestPath(request);
          if (path !== "/" && path !== "/index.html") {
            next();
            return;
          }
          if (!["GET", "HEAD"].includes(request.method || ""))
            throw new HttpError(405, "Only GET and HEAD are allowed.");
          if (request.method === "HEAD") {
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.end();
            return;
          }
          sendHtml(
            response,
            await readFile(resolve(output, "index.html"), "utf8"),
          );
        } catch (error) {
          errorResponse(request, response, error);
        }
      });
    },
  };
}
