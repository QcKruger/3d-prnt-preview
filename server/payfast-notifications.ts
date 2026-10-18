import { createHash, timingSafeEqual } from "node:crypto";
import { BlockList, isIP } from "node:net";
import type { IncomingMessage } from "node:http";
import type { SandboxSettings } from "./payfast.ts";
import type { PrivateRecord, PrivateRecords } from "./private-records.ts";
import { HttpError } from "./security.ts";
import { logPayfastEvent } from "./logging.ts";

export const SANDBOX_VALIDATION_URL =
  "https://sandbox.payfast.co.za/eng/query/validate";
type PaymentStatus = "COMPLETE" | "FAILED" | "CANCELLED" | "PENDING";
export interface PayfastNotification {
  fields: Record<string, string>;
  parameterString: string;
  reference: string;
  paymentId: string;
  status: PaymentStatus;
  grossCents: number;
  feeCents: number | null;
  netCents: number | null;
}
// ITN encoding deliberately retains empty values and whitespace. Outgoing
// checkout signing trims/omits empty fields; incoming ITNs sign every field.
const encode = (s: string) =>
  encodeURIComponent(s)
    .replace(
      /[!'()*~]/g,
      (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
    )
    .replace(/%20/g, "+");
export function notificationSignature(
  parameters: string,
  passphrase: string,
): string {
  return createHash("md5")
    .update(
      parameters + (passphrase ? `&passphrase=${encode(passphrase)}` : ""),
    )
    .digest("hex");
}
function cents(value: string | undefined, allowNegative = false): number {
  if (
    typeof value !== "string" ||
    !(
      allowNegative ? /^-?\d{1,9}(?:\.\d{1,2})?$/ : /^\d{1,9}(?:\.\d{1,2})?$/
    ).test(value)
  )
    throw new HttpError(400, "Invalid notification amount.");
  const negative = value.startsWith("-");
  const [whole, decimal = ""] = value.replace(/^-/, "").split(".");
  return (
    (Number(whole) * 100 + Number(decimal.padEnd(2, "0"))) * (negative ? -1 : 1)
  );
}
export function parseNotification(body: string): PayfastNotification {
  const fields: Record<string, string> = Object.create(null);
  const pairs: string[] = [];
  let sawSignature = false;
  for (const pair of body.split("&")) {
    const separator = pair.indexOf("=");
    if (separator < 1 || sawSignature)
      throw new HttpError(400, "Malformed notification fields.");
    let key: string, value: string;
    try {
      key = decodeURIComponent(pair.slice(0, separator).replace(/\+/g, " "));
      value = decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, " "));
    } catch {
      throw new HttpError(400, "Malformed notification encoding.");
    }
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
      Object.hasOwn(fields, key) ||
      value.length > 4000 ||
      value.includes("\0")
    )
      throw new HttpError(400, "Invalid notification fields.");
    fields[key] = value;
    if (key === "signature") sawSignature = true;
    else pairs.push(`${key}=${encode(value)}`);
  }
  if (
    !sawSignature ||
    !/^[a-f0-9]{32}$/i.test(fields.signature) ||
    !/^\d{1,30}$/.test(fields.pf_payment_id ?? "") ||
    !/^3D-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      fields.m_payment_id ?? "",
    ) ||
    !["COMPLETE", "FAILED", "CANCELLED", "PENDING"].includes(
      fields.payment_status,
    )
  )
    throw new HttpError(
      400,
      "Missing or invalid notification payment details.",
    );
  const grossCents = cents(fields.amount_gross);
  const feeCents =
    fields.amount_fee === undefined ? null : cents(fields.amount_fee, true);
  const netCents =
    fields.amount_net === undefined ? null : cents(fields.amount_net);
  if (
    grossCents < 1 ||
    (feeCents !== null && (feeCents > 0 || feeCents < -grossCents)) ||
    (feeCents !== null &&
      netCents !== null &&
      grossCents + feeCents !== netCents)
  )
    throw new HttpError(400, "Inconsistent notification amounts.");
  return {
    fields,
    parameterString: pairs.join("&"),
    reference: fields.m_payment_id,
    paymentId: fields.pf_payment_id,
    status: fields.payment_status as PaymentStatus,
    grossCents,
    feeCents,
    netCents,
  };
}

// PayFast's documented source ranges, checked 2026-10-18. No arbitrary caller
// forwarding headers or Referer DNS lookup can add a trusted source.
const sources = new BlockList();
for (const [network, prefix] of [
  ["197.97.145.144", 28],
  ["41.74.179.192", 27],
  ["102.216.36.0", 28],
  ["102.216.36.128", 28],
] as const)
  sources.addSubnet(network, prefix);
sources.addAddress("144.126.193.139");
export function notificationSourceAllowed(
  request: IncomingMessage,
  trustAzureIisProxy = false,
): boolean {
  let address = request.socket.remoteAddress || "";
  if (
    trustAzureIisProxy &&
    ["", "127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address)
  ) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded !== "string" || forwarded.length > 2048) return false;
    // The public App Service front end appends the observed peer on the right.
    // Trust exactly one platform hop, only when hosted behind IISNode's pipe.
    address = forwarded.split(",").at(-1)!.trim();
  }
  if (address.startsWith("::ffff:")) address = address.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(address))
    address = address.slice(0, address.lastIndexOf(":"));
  return isIP(address) === 4 && sources.check(address, "ipv4");
}
export function isAzureIisProxy(
  env: Record<string, string | undefined>,
): boolean {
  return Boolean(
    env.WEBSITE_SITE_NAME &&
    env.NODE_ENV === "production" &&
    env.PORT?.startsWith("\\\\.\\pipe\\"),
  );
}
export async function confirmWithPayfast(parameters: string): Promise<boolean> {
  try {
    const response = await fetch(SANDBOX_VALIDATION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: parameters,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok || !response.body) throw new Error("Provider unavailable");
    const reader = response.body.getReader();
    let text = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
      if (text.length > 128) {
        await reader.cancel();
        throw new Error("Invalid provider response");
      }
    }
    return text.trim() === "VALID";
  } catch {
    throw new HttpError(503, "Payment validation is temporarily unavailable.");
  }
}
export interface PaymentNotifications {
  receive(body: string, request: IncomingMessage): Promise<void>;
}
export function createPaymentNotifications(
  settings: SandboxSettings,
  records: PrivateRecords,
  options: {
    sourceAllowed?: (request: IncomingMessage) => boolean;
    confirm?: (parameters: string) => Promise<boolean>;
    log?: (message: string) => void | Promise<void>;
    now?: () => number;
  } = {},
): PaymentNotifications {
  const sourceAllowed = options.sourceAllowed ?? notificationSourceAllowed;
  const confirm = options.confirm ?? confirmWithPayfast;
  const now = options.now ?? Date.now;
  const report = options.log ?? logPayfastEvent;
  async function log(message: string) {
    try {
      await report(message);
    } catch {
      /* Logging never acknowledges an unsaved payment. */
    }
  }
  async function update(
    id: string,
    change: (record: PrivateRecord) => PrivateRecord | undefined,
  ) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const current = await records.read(id);
      if (!current)
        throw new HttpError(503, "Payment record is temporarily unavailable.");
      const next = change(current);
      if (!next) return;
      if (typeof current._etag !== "string")
        throw new HttpError(
          503,
          "A conditional payment update could not be performed.",
        );
      try {
        await records.replace(next, current._etag);
        return;
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 412) throw error;
      }
    }
    throw new HttpError(503, "Payment record is busy. Please retry.");
  }
  return {
    async receive(body, request) {
      let stage = "parse";
      try {
        const notification = parseNotification(body);
        const {
          fields,
          parameterString,
          reference,
          paymentId,
          status,
          grossCents,
          feeCents,
          netCents,
        } = notification;
        stage = "signature";
        if (
          !timingSafeEqual(
            Buffer.from(
              notificationSignature(parameterString, settings.passphrase),
              "hex",
            ),
            Buffer.from(fields.signature, "hex"),
          )
        )
          throw new HttpError(403, "Invalid payment notification.");
        stage = "merchant";
        if (fields.merchant_id !== settings.merchantId)
          throw new HttpError(403, "Invalid payment notification.");
        stage = "source";
        if (
          !sourceAllowed(request) ||
          request.headers["sec-fetch-site"] === "cross-site"
        )
          throw new HttpError(403, "Invalid payment notification source.");
        stage = "order";
        const orderId = `order:${reference.slice(3)}`;
        const order = await records.read(orderId);
        // The merchant/amount are pinned at checkout, independent of later
        // catalogue changes. Legacy records without this binding cannot be paid.
        if (
          !order ||
          order.EntityType !== "Order" ||
          order.paymentMode !== "sandbox" ||
          order.reference !== reference ||
          order.currency !== "ZAR" ||
          order.paymentMerchantId !== fields.merchant_id
        )
          throw new HttpError(
            400,
            "Payment notification does not match an eligible checkout.",
          );
        stage = "amount";
        if (
          !Number.isSafeInteger(order.totalCents) ||
          order.totalCents !== grossCents
        )
          throw new HttpError(400, "Payment amount does not match checkout.");
        stage = "provider-confirmation";
        if (!(await confirm(parameterString)))
          throw new HttpError(403, "Payment notification was not confirmed.");
        const verifiedAt = new Date(now()).toISOString();
        const transactionId = `transaction:payfast:sandbox:${paymentId}`;
        const snapshot = {
          provider: "payfast",
          mode: "sandbox",
          merchantId: fields.merchant_id,
          providerPaymentId: paymentId,
          orderReference: reference,
          grossCents,
          feeCents,
          netCents,
          currency: "ZAR",
          paymentStatus: status,
          verifiedAt,
          verification: "signature-source-amount-server",
        };
        stage = "transaction-save";
        try {
          await records.create({
            id: transactionId,
            ID: transactionId,
            EntityType: "Transaction",
            schemaVersion: 1,
            ...snapshot,
          });
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 409)
            throw error;
          const existing = await records.read(transactionId);
          if (
            !existing ||
            existing.orderReference !== reference ||
            existing.grossCents !== grossCents ||
            existing.merchantId !== fields.merchant_id
          )
            throw new HttpError(
              409,
              "Payment identifier is already bound to another checkout.",
            );
        }
        stage = "event-save";
        const digest = createHash("sha256")
          .update(parameterString)
          .digest("hex");
        const eventId = `payment-event:${paymentId}:${digest}`;
        try {
          await records.create({
            id: eventId,
            ID: eventId,
            EntityType: "PaymentEvent",
            schemaVersion: 1,
            ...snapshot,
            notificationHash: digest,
          });
        } catch (error) {
          if (!(error instanceof HttpError) || error.status !== 409)
            throw error;
        }
        stage = "transaction-update";
        await update(transactionId, (current) => {
          if (
            current.orderReference !== reference ||
            current.grossCents !== grossCents
          )
            throw new HttpError(409, "Conflicting payment notification.");
          // COMPLETE is final for this once-off integration. A stale PENDING or
          // failure event remains in the audit trail without downgrading it.
          if (
            current.paymentStatus === "COMPLETE" ||
            current.paymentStatus === status ||
            (current.paymentStatus !== "PENDING" && status === "PENDING")
          )
            return undefined;
          return { ...current, ...snapshot };
        });
        const savedTransaction = await records.read(transactionId);
        if (!savedTransaction)
          throw new HttpError(503, "Payment record could not be confirmed.");
        const effectiveStatus = savedTransaction.paymentStatus;
        stage = "order-update";
        await update(orderId, (current) => {
          if (
            current.totalCents !== grossCents ||
            current.paymentMerchantId !== fields.merchant_id
          )
            throw new HttpError(409, "Checkout changed during validation.");
          if (current.paymentStatus === "verified-sandbox") return undefined;
          const fulfilment = current.fulfilment as
            Record<string, unknown> | undefined;
          if (effectiveStatus === "COMPLETE")
            return {
              ...current,
              paymentStatus: "verified-sandbox",
              status: "sandbox-payment-confirmed",
              paymentTransactionId: transactionId,
              paymentVerifiedAt: savedTransaction.verifiedAt,
              ...(fulfilment?.status === "awaiting-payment-verification"
                ? {
                    fulfilment: {
                      ...fulfilment,
                      status: "awaiting-processing",
                    },
                  }
                : {}),
            };
          if (effectiveStatus === "PENDING") return undefined;
          return {
            ...current,
            paymentStatus:
              effectiveStatus === "FAILED" ? "failed" : "cancelled",
            status:
              effectiveStatus === "FAILED"
                ? "payment-failed"
                : "payment-cancelled",
          };
        });
        await log(
          `Sandbox ITN accepted; transaction, event and order persisted. status=${status}.`,
        );
      } catch (error) {
        const code = error instanceof HttpError ? error.status : 503;
        await log(
          `ITN not acknowledged. stage=${stage} HTTP ${code}. ${code >= 500 ? "Retry required; completed writes are safe to replay." : "Notification rejected; no trusted payment state was inferred."}`,
        );
        if (error instanceof HttpError) throw error;
        throw new HttpError(
          503,
          "Payment notification could not be saved. Please retry.",
        );
      }
    },
  };
}
