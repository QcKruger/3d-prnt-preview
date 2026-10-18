import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PaymentRedirect, Product } from "../src/types.ts";
import type { SavedFulfilment } from "../src/fulfilment.ts";
import type { TrackingAccess, TrackingView } from "../src/tracking.ts";
import { createPrivateRecords } from "./private-records.ts";
import type { PrivateRecords, PrivateRecord } from "./private-records.ts";
import type { ReturnStore } from "./returns.ts";
import { HttpError } from "./security.ts";

export interface CheckoutReceipt {
  reference: string;
  totalCents: number;
  subtotalCents: number;
  fulfilment: SavedFulfilment;
  tracking: TrackingAccess;
  localDevelopment: boolean;
}
export interface GuestJourney {
  saveOrder(
    input: unknown,
    checkout: PaymentRedirect,
    products: readonly Product[],
    fulfilment: SavedFulfilment,
  ): Promise<CheckoutReceipt>;
  returnTracking(reference: string): Promise<TrackingAccess>;
  view(token: string): Promise<TrackingView>;
  close(): void;
}
export const unavailableJourney: GuestJourney = {
  async saveOrder() {
    throw new HttpError(
      503,
      "Order storage is temporarily unavailable. Please try again shortly.",
    );
  },
  async returnTracking() {
    throw new HttpError(503, "Tracking is temporarily unavailable.");
  },
  async view() {
    throw new HttpError(503, "Tracking is temporarily unavailable.");
  },
  close() {},
};
export function checkoutRequestId(input: unknown): string {
  const value =
    input && typeof input === "object"
      ? (input as Record<string, unknown>).requestId
      : undefined;
  if (value === undefined) return randomUUID();
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(
      400,
      "Invalid checkout identifier. Refresh and try again.",
    );
  return value.toLowerCase();
}
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const invalidLink = () =>
  new HttpError(404, "This tracking link is invalid or has expired.");

export function createGuestJourney(
  env: Record<string, string | undefined>,
  returns: ReturnStore,
  records: PrivateRecords = createPrivateRecords(env),
  now: () => number = Date.now,
): GuestJourney {
  const hours = env.GUEST_TRACKING_TTL_HOURS ?? "168";
  if (!/^\d+$/.test(hours) || Number(hours) < 1 || Number(hours) > 720)
    throw new Error("GUEST_TRACKING_TTL_HOURS must be between 1 and 720.");
  async function issue(
    kind: "order" | "return",
    reference: string,
  ): Promise<TrackingAccess> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now() + Number(hours) * 3_600_000).toISOString();
    const id = `tracking:${hash(token)}`;
    await records.create({
      id,
      ID: id,
      EntityType: "GuestTracking",
      schemaVersion: 1,
      kind,
      reference,
      expiresAt,
      createdAt: new Date(now()).toISOString(),
      ttl: Number(hours) * 3600,
    });
    return { token, expiresAt };
  }
  return {
    async saveOrder(input, checkout, products, fulfilment) {
      const fields = checkout.fields;
      const reference = fields.m_payment_id;
      const id = `order:${reference.slice(3)}`;
      const data = input as { productIds: number[] };
      const counts = new Map<number, number>();
      for (const productId of data.productIds)
        counts.set(productId, (counts.get(productId) || 0) + 1);
      const items = [...counts].map(([productId, quantity]) => {
        const p = products.find((p) => p.id === productId)!;
        return {
          productId,
          name: p.name,
          quantity,
          unitPriceCents: Math.round(p.price * 100),
        };
      });
      const subtotalCents = items.reduce(
        (sum, item) => sum + item.unitPriceCents * item.quantity,
        0,
      );
      const details = {
        paymentMerchantId: fields.merchant_id,
        contact: {
          firstName: fields.name_first,
          lastName: fields.name_last,
          email: fields.email_address.toLowerCase(),
        },
        items,
        fulfilment,
        subtotalCents,
        totalCents: subtotalCents + fulfilment.feeCents,
        currency: "ZAR",
      };
      const fingerprint = hash(JSON.stringify(details));
      const document: PrivateRecord = {
        id,
        ID: id,
        EntityType: "Order",
        schemaVersion: 1,
        reference,
        createdAt: new Date(now()).toISOString(),
        status: "awaiting-payment-verification",
        paymentStatus: "unverified",
        paymentMode: "sandbox",
        customerId: null,
        ...details,
        submissionHash: fingerprint,
      };
      try {
        await records.create(document);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 409) throw error;
        const existing = await records.read(id);
        if (!existing || existing.submissionHash !== fingerprint)
          throw new HttpError(
            409,
            "This checkout was already saved with different details. Start a new checkout.",
          );
        if (existing.paymentStatus === "verified-sandbox")
          throw new HttpError(
            409,
            "This checkout payment is already confirmed. Use your tracking link.",
          );
      }
      const tracking = await issue("order", reference);
      return {
        reference,
        subtotalCents,
        totalCents: details.totalCents,
        fulfilment,
        tracking,
        localDevelopment: records.local,
      };
    },
    async returnTracking(reference) {
      return issue("return", reference);
    },
    async view(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalidLink();
      const grant = await records.read(`tracking:${hash(token)}`);
      if (
        !grant ||
        grant.EntityType !== "GuestTracking" ||
        typeof grant.expiresAt !== "string" ||
        !Number.isFinite(Date.parse(grant.expiresAt)) ||
        Date.parse(grant.expiresAt) <= now() ||
        typeof grant.reference !== "string"
      )
        throw invalidLink();
      const common = {
        reference: grant.reference,
        expiresAt: grant.expiresAt,
        localDevelopment: records.local,
      };
      if (grant.kind === "return") {
        const record = await returns.lookup(grant.reference);
        if (!record) throw invalidLink();
        const statuses = [
          "pending-review",
          "under-review",
          "approved",
          "declined",
          "awaiting-item",
          "received",
          "resolved",
          "cancelled",
        ];
        return {
          ...common,
          kind: "return",
          createdAt: record.createdAt,
          status: statuses.includes(record.status)
            ? record.status
            : "pending-review",
          handlingFeePercent:
            typeof record.handlingFee?.percent === "number" &&
            Number.isFinite(record.handlingFee.percent) &&
            record.handlingFee.percent >= 0 &&
            record.handlingFee.percent <= 100
              ? record.handlingFee.percent
              : 10,
        };
      }
      if (grant.kind !== "order" || !/^3D-[a-f0-9-]{36}$/.test(grant.reference))
        throw invalidLink();
      const record = await records.read(`order:${grant.reference.slice(3)}`);
      if (!record || record.EntityType !== "Order") throw invalidLink();
      const fulfilment = record.fulfilment as SavedFulfilment;
      if (
        !fulfilment ||
        !["collection", "delivery"].includes(fulfilment.method)
      )
        throw invalidLink();
      const statuses =
        fulfilment.method === "collection"
          ? [
              "awaiting-processing",
              "preparing",
              "ready-for-collection",
              "collected",
              "cancelled",
            ]
          : [
              "awaiting-processing",
              "preparing",
              "dispatched",
              "delivered",
              "cancelled",
            ];
      let status: string = statuses.includes(fulfilment.status)
        ? fulfilment.status
        : "awaiting-payment-verification";
      const paymentStatus =
        record.paymentStatus === "verified-sandbox"
          ? "verified-sandbox"
          : record.paymentStatus === "failed"
            ? "failed"
            : record.paymentStatus === "cancelled"
              ? "cancelled"
              : "unverified";
      if (
        status === "awaiting-payment-verification" &&
        (paymentStatus === "failed" || paymentStatus === "cancelled")
      )
        status =
          paymentStatus === "failed" ? "payment-failed" : "payment-cancelled";
      // Explicit safe projection: never return contact, address, notes, payment
      // fields, hashes or raw documents to a bearer link.
      const safeText = (s: unknown) =>
        typeof s === "string" && s.length <= 500 ? s : undefined;
      return {
        ...common,
        kind: "order",
        createdAt: String(record.createdAt),
        status,
        paymentStatus,
        fulfilment: {
          method: fulfilment.method,
          status,
          feeCents: Number.isSafeInteger(fulfilment.feeCents)
            ? fulfilment.feeCents
            : 0,
          ...(fulfilment.method === "collection"
            ? {
                collectionAddress: safeText(fulfilment.collectionAddress),
                collectionHours: safeText(fulfilment.collectionHours),
              }
            : { deliveryEstimate: safeText(fulfilment.deliveryEstimate) }),
        },
      };
    },
    close() {
      records.close();
    },
  };
}
