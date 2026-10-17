import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { unavailableContent } from "./content.ts";
import type { ContentSource } from "./content.ts";
import {
  checkRequestOrigin,
  checkoutLimiter,
  errorResponse,
  HttpError,
  readJson,
  requestPath,
  securityHeaders,
  checkRequestHost,
} from "./security.ts";
import type {
  PaymentConfig,
  PaymentRedirect,
  PaymentRequest,
  Product,
} from "../src/types.ts";

export const SANDBOX_ACTION = "https://sandbox.payfast.co.za/eng/process";
export const DEFAULT_RETURN_URL = "https://qckruger.github.io/3d-prnt-preview/";

export interface SandboxSettings {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  returnUrl: string;
  cancelUrl: string;
}

export function sandboxSettings(
  env: Record<string, string | undefined>,
): SandboxSettings {
  if (
    Object.keys(env).some(
      (key) =>
        key.startsWith("VITE_") && /PAYFAST|MERCHANT|PASSPHRASE/i.test(key),
    )
  ) {
    throw new Error(
      "Remove payment credentials from VITE_ variables. Use server-only PAYFAST_SANDBOX_ variables.",
    );
  }
  const merchantId = env.PAYFAST_SANDBOX_MERCHANT_ID?.trim();
  const merchantKey = env.PAYFAST_SANDBOX_MERCHANT_KEY?.trim();
  const passphrase = env.PAYFAST_SANDBOX_PASSPHRASE?.trim();
  if (Boolean(merchantId) !== Boolean(merchantKey))
    throw new Error("Set both sandbox merchant ID and merchant key.");
  if ((merchantId && !passphrase) || (!merchantId && passphrase))
    throw new Error("Set sandbox merchant ID, key, and passphrase together.");
  if (passphrase && passphrase.length > 32)
    throw new Error("Sandbox passphrases must be at most 32 characters.");
  const returnUrl = env.PAYFAST_RETURN_URL || DEFAULT_RETURN_URL;
  const cancelUrl = env.PAYFAST_CANCEL_URL || DEFAULT_RETURN_URL;
  for (const url of [returnUrl, cancelUrl]) {
    const destination = new URL(url);
    if (
      destination.protocol !== "https:" ||
      destination.username ||
      destination.password
    )
      throw new Error("Payment redirects must use HTTPS.");
  }
  return {
    // PayFast's documented public sandbox merchant. Never use live credentials here.
    merchantId: merchantId || "10004002",
    merchantKey: merchantKey || "q1cd2rdny4a53",
    passphrase: passphrase || "payfast",
    returnUrl,
    cancelUrl,
  };
}

// Match PHP urlencode, including '+' spaces and uppercase percent escapes.
export function payfastEncode(value: string): string {
  return encodeURIComponent(value.trim())
    .replace(
      /[!'()*~]/g,
      (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/%20/g, "+");
}

export function signFields(
  fields: Record<string, string>,
  passphrase: string,
): string {
  const pairs = Object.entries(fields)
    .filter(([key, value]) => key !== "signature" && value !== "")
    .map(([key, value]) => `${key}=${payfastEncode(value)}`);
  if (passphrase) pairs.push(`passphrase=${payfastEncode(passphrase)}`);
  return createHash("md5").update(pairs.join("&")).digest("hex");
}

export function createCheckout(
  input: unknown,
  settings: SandboxSettings,
  products: readonly Product[],
): PaymentRedirect {
  if (!input || typeof input !== "object")
    throw new Error("Invalid checkout details.");
  const request = input as Partial<PaymentRequest>;
  const text = (value: unknown, max: number) =>
    typeof value === "string" && value.trim().length <= max ? value.trim() : "";
  const firstName = text(request.firstName, 50);
  const lastName = text(request.lastName, 50);
  const email = text(request.email, 100);
  if (!firstName || !lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error(
      "Enter your first name, surname and a valid email address.",
    );
  if (
    !Array.isArray(request.productIds) ||
    !request.productIds.length ||
    request.productIds.length > 160
  )
    throw new Error("Choose between 1 and 160 catalogue items.");
  const quantities = new Map<number, number>();
  let totalCents = 0;
  for (const id of request.productIds) {
    const product = products.find((product) => product.id === id);
    if (!product || product.shape === "sign")
      throw new Error("Your cart contains an unavailable product.");
    const quantity = (quantities.get(id) || 0) + 1;
    if (quantity > 20)
      throw new Error(
        "The sandbox checkout supports up to 20 of each product.",
      );
    quantities.set(id, quantity);
    totalCents += Math.round(product.price * 100);
  }
  const reference = `3D-${randomUUID()}`;
  // Preserve the documented custom-integration field order when signing.
  const fields: Record<string, string> = {
    merchant_id: settings.merchantId,
    merchant_key: settings.merchantKey,
    return_url: settings.returnUrl,
    cancel_url: settings.cancelUrl,
    name_first: firstName,
    name_last: lastName,
    email_address: email,
    m_payment_id: reference,
    amount: (totalCents / 100).toFixed(2),
    item_name: `3D PRNT sandbox ${reference}`,
    item_description: `${request.productIds.length} test item(s). Collection only. No real order.`,
  };
  fields.signature = signFields(fields, settings.passphrase);
  return { action: SANDBOX_ACTION, fields };
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(body));
}

export function createPaymentHandler(
  settings: SandboxSettings,
  options: {
    development?: boolean;
    httpsOnly?: boolean;
    limiter?: ReturnType<typeof checkoutLimiter>;
    bodyTimeoutMs?: number;
    allowedHost?: string;
    requestLimiter?: ReturnType<typeof checkoutLimiter>;
    contentSource?: ContentSource;
  } = {},
) {
  const limit = options.limiter || checkoutLimiter();
  const contentSource = options.contentSource || unavailableContent;
  const requests =
    options.requestLimiter ||
    checkoutLimiter({ limit: 300, globalLimit: 5000 });
  const config: PaymentConfig = {
    enabled: true,
    mode: "sandbox",
    fulfilment: "collection",
    notificationsEnabled: false,
  };
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next?: () => void,
  ) => {
    securityHeaders(response, {
      ...options,
      redirectOrigins: [
        ...new Set([
          new URL(settings.returnUrl).origin,
          new URL(settings.cancelUrl).origin,
        ]),
      ],
    });
    response.setHeader("Cache-Control", "no-store");
    try {
      const requestRetry = requests(request.socket.remoteAddress || "unknown");
      if (requestRetry) {
        response.setHeader("Retry-After", String(requestRetry));
        throw new HttpError(
          429,
          "Too many requests. Please try again shortly.",
        );
      }
      checkRequestHost(request, options.allowedHost);
      const pathname = requestPath(request);
      if (!["GET", "HEAD", "POST"].includes(request.method || "")) {
        response.setHeader("Allow", "GET, HEAD, POST");
        throw new HttpError(405, "Request method is not allowed.");
      }
      if (
        ["GET", "HEAD"].includes(request.method || "") &&
        (Number(request.headers["content-length"]) > 0 ||
          request.headers["transfer-encoding"])
      )
        throw new HttpError(400, "This request must not contain a body.");
      if (pathname === "/api/content") {
        if (request.method !== "GET") {
          response.setHeader("Allow", "GET");
          throw new HttpError(405, "Use GET for site content.");
        }
        const result = await contentSource.get();
        json(response, result.available ? 200 : 503, result.content);
        return;
      }
      if (!pathname.startsWith("/api/payment/")) {
        next?.();
        return;
      }
      if (pathname === "/api/payment/config" && request.method === "GET") {
        json(response, 200, config);
        return;
      }
      if (pathname !== "/api/payment/checkout") {
        json(response, 404, { message: "Payment endpoint not found." });
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        json(response, 405, { message: "Use POST for checkout." });
        return;
      }
      const retryAfter = limit(request.socket.remoteAddress || "unknown");
      if (retryAfter) {
        response.setHeader("Retry-After", String(retryAfter));
        throw new HttpError(
          429,
          "Too many checkout attempts. Please try again shortly.",
        );
      }
      checkRequestOrigin(request);
      if (
        request.headers["content-encoding"] &&
        request.headers["content-encoding"] !== "identity"
      )
        throw new HttpError(
          415,
          "Compressed checkout bodies are not accepted.",
        );
      if (
        request.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
        "application/json"
      ) {
        json(response, 415, { message: "Checkout requires JSON." });
        return;
      }
      const input = await readJson(request, options.bodyTimeoutMs);
      const catalogue = await contentSource.get();
      if (!catalogue.available)
        throw new HttpError(
          503,
          "Products are temporarily unavailable. Please try again shortly.",
        );
      let checkout: PaymentRedirect;
      try {
        checkout = createCheckout(input, settings, catalogue.content.products);
      } catch (error) {
        throw new HttpError(
          400,
          error instanceof URIError
            ? "Invalid characters in checkout details."
            : error instanceof Error
              ? error.message
              : "Invalid checkout details.",
        );
      }
      json(response, 200, checkout);
    } catch (error) {
      errorResponse(request, response, error);
    }
  };
}
