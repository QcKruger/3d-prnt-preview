import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse, Server } from "node:http";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function requestPath(request: IncomingMessage): string {
  const target = request.url || "/";
  // Only origin-form targets are accepted; never interpret a supplied host.
  if (
    !target.startsWith("/") ||
    target.startsWith("//") ||
    target.includes("\\") ||
    target.length > 2048 ||
    /[\u0000-\u0020\u007f]/.test(target)
  )
    throw new HttpError(400, "Invalid request URL.");
  try {
    return new URL(target, "http://internal").pathname;
  } catch {
    throw new HttpError(400, "Invalid request URL.");
  }
}

export interface SecurityOptions {
  development?: boolean;
  httpsOnly?: boolean;
  redirectOrigins: string[];
  allowedHost?: string;
}

export function securityHeaders(
  response: ServerResponse,
  options: SecurityOptions,
) {
  const nonce = randomBytes(24).toString("base64");
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    `script-src 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    "style-src-attr 'none'",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src 'self'${options.development ? " ws: wss:" : ""}`,
    `form-action 'self' https://sandbox.payfast.co.za ${options.redirectOrigins.join(" ")}`,
  ];
  response.setHeader("Content-Security-Policy", directives.join("; "));
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (options.httpsOnly)
    response.setHeader("Strict-Transport-Security", "max-age=31536000");
}

export function checkRequestHost(
  request: IncomingMessage,
  allowedHost?: string,
) {
  try {
    const host = request.headers.host;
    if (!host || /[\s,/@\\]/.test(host)) throw new Error();
    const parsed = new URL("http://" + host);
    if (
      !["127.0.0.1", "localhost", "[::1]", allowedHost].includes(
        parsed.hostname,
      )
    )
      throw new Error();
  } catch {
    throw new HttpError(403, "Request host is not allowed.");
  }
}

export function hardenServer(
  server: Server,
  options: { maxConnections?: number; maxPerAddress?: number } = {},
) {
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 100;
  server.maxHeadersCount = 50;
  server.maxConnections = options.maxConnections || 256;
  server.setTimeout(15_000, (socket) => socket.destroy());
  const clients = new Map<string, number>();
  server.on("connection", (socket) => {
    const address = socket.remoteAddress || "unknown";
    const count = clients.get(address) || 0;
    if (count >= (options.maxPerAddress || 32)) {
      socket.destroy();
      return;
    }
    clients.set(address, count + 1);
    socket.once("close", () => {
      const remaining = (clients.get(address) || 1) - 1;
      if (remaining) clients.set(address, remaining);
      else clients.delete(address);
    });
  });
}

// Counters exist in memory only, contain no customer data, and expire after a minute.
// Forwarded IP headers are deliberately ignored: they are spoofable without a trusted proxy.
export function checkoutLimiter(
  options: {
    limit?: number;
    globalLimit?: number;
    windowMs?: number;
    maxEntries?: number;
    now?: () => number;
  } = {},
) {
  const {
    limit = 20,
    globalLimit = 200,
    windowMs = 60_000,
    maxEntries = 10_000,
    now = Date.now,
  } = options;
  const salt = randomBytes(32);
  const clients = new Map<string, { count: number; expires: number }>();
  let global = { count: 0, expires: 0 };
  return (address: string) => {
    const time = now();
    for (const [key, value] of clients)
      if (value.expires <= time) clients.delete(key);
    if (global.expires <= time) global = { count: 0, expires: time + windowMs };
    if (global.count >= globalLimit)
      return Math.max(1, Math.ceil((global.expires - time) / 1000));
    const key = createHmac("sha256", salt).update(address).digest("hex");
    let client = clients.get(key);
    if (!client && clients.size >= maxEntries)
      return Math.ceil(windowMs / 1000);
    if (!client) {
      client = { count: 0, expires: time + windowMs };
      clients.set(key, client);
    }
    if (global.count >= globalLimit || client.count >= limit)
      return Math.max(
        1,
        Math.ceil(
          ((global.count >= globalLimit ? global.expires : client.expires) -
            time) /
            1000,
        ),
      );
    global.count++;
    client.count++;
    return 0;
  };
}

export function checkRequestOrigin(request: IncomingMessage) {
  // There are no authenticated sessions, but reject cross-site browser API requests.
  // JSON + no CORS already blocks ordinary cross-site forms; enforce Fetch Metadata too.
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new HttpError(403, "Cross-site checkout is not allowed.");
  const origin = request.headers.origin;
  if (origin) {
    try {
      const url = new URL(origin);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.origin !== origin ||
        url.host !== request.headers.host
      )
        throw new Error();
    } catch {
      throw new HttpError(403, "Cross-site checkout is not allowed.");
    }
  }
}

export function readJson(
  request: IncomingMessage,
  timeoutMs = 10_000,
): Promise<unknown> {
  const limit = 16_384;
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onAborted);
    };
    const fail = (error: Error) => {
      cleanup();
      // A disconnected request can emit an error after its aborted event.
      request.once("error", () => {});
      request.pause();
      reject(error);
    };
    const onError = () => fail(new HttpError(400, "Request interrupted."));
    const onAborted = () => fail(new HttpError(400, "Request interrupted."));
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        fail(new HttpError(413, "Checkout request is too large."));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => {
      cleanup();
      try {
        resolve(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
      } catch {
        reject(new HttpError(400, "Invalid JSON."));
      }
    };
    const timer = setTimeout(
      () => fail(new HttpError(408, "Checkout request timed out.")),
      timeoutMs,
    );
    if (Number(request.headers["content-length"]) > limit) {
      fail(new HttpError(413, "Checkout request is too large."));
      return;
    }
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onAborted);
  });
}

export function errorResponse(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const status = error instanceof HttpError ? error.status : 500;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Connection", "close");
  response.once("finish", () => request.destroy());
  response.writeHead(status);
  response.end(
    JSON.stringify({
      message:
        error instanceof HttpError
          ? error.message
          : "The server could not process this request.",
    }),
  );
}
