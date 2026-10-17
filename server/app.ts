import { createServer } from "node:http";
import {
  createReadStream,
  readdirSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { resolve, relative, sep, extname } from "node:path";
import { createPaymentHandler } from "./payfast.ts";
import type { SandboxSettings } from "./payfast.ts";
import {
  errorResponse,
  hardenServer,
  HttpError,
  requestPath,
} from "./security.ts";
import { sendHtml } from "./html.ts";
import type { ContentSource } from "./content.ts";

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

export function builtAssets(directory: string) {
  const root = realpathSync(directory);
  const assets = new Map<string, string>();
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const filename = resolve(folder, entry.name);
      if (lstatSync(filename).isSymbolicLink())
        throw new Error("Symbolic links are not allowed in the public build.");
      if (entry.isDirectory()) {
        walk(filename);
        continue;
      }
      const local = relative(root, filename).split(sep).join("/");
      if (
        local === "index.html" ||
        (/^assets\/[A-Za-z0-9_./-]+$/.test(local) &&
          types[extname(filename)] &&
          extname(filename) !== ".html") ||
        local === "3d-prnt-logo.png"
      )
        assets.set("/" + local, filename);
    }
  };
  walk(root);
  if (!assets.has("/index.html")) throw new Error("Run npm run build first.");
  return assets;
}

export function createAppServer(
  directory: string,
  settings: SandboxSettings,
  options: {
    httpsOnly?: boolean;
    allowedHost?: string;
    maxConnections?: number;
    maxPerAddress?: number;
    contentSource?: ContentSource;
  } = {},
) {
  const assets = builtAssets(directory);
  const index = readFileSync(assets.get("/index.html")!, "utf8");
  const handler = createPaymentHandler(settings, options);
  const server = createServer(
    { maxHeaderSize: 8192, insecureHTTPParser: false },
    (request, response) => {
      void handler(request, response, () => {
        if (request.method !== "GET" && request.method !== "HEAD")
          throw new HttpError(
            405,
            "Only GET and HEAD are allowed for site assets.",
          );
        let pathname: string;
        try {
          pathname = decodeURIComponent(requestPath(request));
        } catch {
          throw new HttpError(400, "Invalid asset path.");
        }
        if (
          pathname.includes("\\") ||
          pathname.includes("\0") ||
          pathname
            .split("/")
            .some((part) => part === ".." || part.startsWith("."))
        )
          throw new HttpError(404, "Not found.");
        const filename = assets.get(
          pathname === "/" ? "/index.html" : pathname,
        );
        if (!filename) throw new HttpError(404, "Not found.");
        if (extname(filename) === ".html") {
          if (request.method === "HEAD") {
            response.setHeader("Content-Type", types[".html"]);
            response.end();
            return;
          }
          sendHtml(response, index);
          return;
        }
        response.setHeader("Content-Type", types[extname(filename)]);
        if (request.method === "HEAD") {
          response.end();
          return;
        }
        createReadStream(filename)
          .on("error", () => response.destroy())
          .pipe(response);
      }).catch((error) => errorResponse(request, response, error));
    },
  );
  server.on("checkContinue", (request, response) =>
    errorResponse(
      request,
      response,
      new HttpError(417, "Expect requests are not supported."),
    ),
  );
  hardenServer(server, options);
  return server;
}
