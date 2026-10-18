import { createHash } from "node:crypto";
import {
  initialReturn,
  validateReturn,
  RETURN_HANDLING_FEE_PERCENT,
} from "../src/returns.ts";
import type { ReturnFields, ReturnReceipt } from "../src/returns.ts";
import { cosmosSettings, createCosmosConnection } from "./cosmos.ts";
import { isLocalDevelopment } from "./content.ts";
import { describeCosmosFailure, logCosmosFailure } from "./logging.ts";
import { HttpError } from "./security.ts";

export interface ReturnSubmission {
  requestId: string;
  fields: ReturnFields;
}

export function parseReturn(input: unknown): ReturnSubmission {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new HttpError(400, "Invalid return request.");
  const data = input as Record<string, unknown>;
  if (
    typeof data.requestId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      data.requestId,
    )
  )
    throw new HttpError(
      400,
      "Invalid return request identifier. Refresh the page and try again.",
    );
  const fields = data as unknown as ReturnFields;
  const errors = validateReturn(fields);
  if (Object.keys(errors).length)
    throw new HttpError(400, Object.values(errors)[0]!);
  // Explicit projection prevents client-supplied status, user ID or approval.
  const clean = Object.fromEntries(
    Object.keys(initialReturn).map((key) => {
      const value = fields[key as keyof ReturnFields];
      return [key, typeof value === "string" ? value.trim() : value];
    }),
  ) as unknown as ReturnFields;
  clean.email = clean.email.toLowerCase();
  clean.quantity = String(Number(clean.quantity));
  return { requestId: data.requestId.toLowerCase(), fields: clean };
}

export interface ReturnDocument {
  id: string;
  ID: string;
  EntityType: "ReturnRequest";
  schemaVersion: 1;
  reference: string;
  status: "pending-review";
  createdAt: string;
  customerId: null;
  orderVerification: "unverified";
  contact: { name: string; email: string };
  orderReference: string;
  item: string;
  quantity: number;
  reason: string;
  description: string;
  requestedResolution: string;
  consentRecordedAt: string;
  handlingFee: {
    percent: number;
    basis: "approved-refund-amount";
    amountCents: null;
    acknowledgedAt: string;
    policyVersion: "handling-fee-v1";
  };
  submissionHash: string;
}

export function returnDocument(submission: ReturnSubmission): ReturnDocument {
  const { requestId, fields } = submission;
  const id = `return:${requestId}`;
  const createdAt = new Date().toISOString();
  return {
    id,
    ID: id,
    EntityType: "ReturnRequest",
    schemaVersion: 1,
    reference: `RMA-${requestId}`,
    status: "pending-review",
    createdAt,
    customerId: null,
    orderVerification: "unverified",
    contact: { name: fields.name, email: fields.email },
    orderReference: fields.orderReference,
    item: fields.item,
    quantity: Number(fields.quantity),
    reason: fields.reason,
    description: fields.description,
    requestedResolution: fields.resolution,
    consentRecordedAt: createdAt,
    handlingFee: {
      percent: RETURN_HANDLING_FEE_PERCENT,
      basis: "approved-refund-amount",
      amountCents: null,
      acknowledgedAt: createdAt,
      policyVersion: "handling-fee-v1",
    },
    submissionHash: createHash("sha256")
      .update(JSON.stringify(fields))
      .digest("hex"),
  };
}

export interface ReturnStore {
  submit(input: ReturnSubmission): Promise<ReturnReceipt>;
  lookup(reference: string): Promise<ReturnDocument | undefined>;
  close(): void;
}
export const unavailableReturns: ReturnStore = {
  async lookup() {
    return undefined;
  },
  async submit() {
    throw new HttpError(
      503,
      "Return requests are temporarily unavailable. Keep your details and try again shortly.",
    );
  },
  close() {},
};

export function createReturnStore(
  env: Record<string, string | undefined>,
  connect = createCosmosConnection,
  report: (message: string) => void | Promise<void> = logCosmosFailure,
): ReturnStore {
  const local = isLocalDevelopment(env);
  // Local simulation only: bounded, expires and is cleared on shutdown.
  const memory = new Map<string, ReturnDocument>();
  let connection: ReturnType<typeof connect> | undefined;
  let lastLog = -Infinity;
  let closed = false;
  return {
    async lookup(reference) {
      if (closed || !/^RMA-[a-f0-9-]{36}$/.test(reference)) return undefined;
      const id = `return:${reference.slice(4)}`;
      if (local) return memory.get(id);
      try {
        if (!connection) {
          const settings = cosmosSettings(env);
          if (!settings) throw new Error("Missing configuration");
          connection = connect(settings);
        }
        const { resource } = await connection.container
          .item(id, id)
          .read<ReturnDocument>({ abortSignal: AbortSignal.timeout(8_000) });
        return resource?.EntityType === "ReturnRequest" ? resource : undefined;
      } catch (error) {
        if ((error as { code?: number })?.code === 404) return undefined;
        connection?.client.dispose();
        connection = undefined;
        try {
          await report(
            `Return tracking lookup unavailable. ${describeCosmosFailure(error, "query")}`,
          );
        } catch {
          /* Keep private details out of logs. */
        }
        throw new HttpError(503, "Tracking is temporarily unavailable.");
      }
    },
    async submit(submission) {
      if (closed) return unavailableReturns.submit(submission);
      const document = returnDocument(submission);
      if (local) {
        for (const [id, item] of memory)
          if (Date.parse(item.createdAt) < Date.now() - 86_400_000)
            memory.delete(id);
        const existing = memory.get(document.id);
        if (existing && existing.submissionHash !== document.submissionHash)
          throw new HttpError(
            409,
            "This request identifier was already used. Start a new request.",
          );
        if (!existing && memory.size >= 1000)
          throw new HttpError(
            503,
            "Local test storage is full. Restart the development server.",
          );
        if (!existing) memory.set(document.id, document);
      } else {
        let phase: "configuration" | "client" | "write" = "configuration";
        try {
          if (!connection) {
            const settings = cosmosSettings(env);
            if (!settings) throw new Error("Missing data configuration");
            phase = "client";
            connection = connect(settings);
          }
          phase = "write";
          try {
            await connection.container.items.create(document, {
              abortSignal: AbortSignal.timeout(8_000),
            });
          } catch (error) {
            if ((error as { code?: number })?.code !== 409) throw error;
            // A lost HTTP response can be retried safely without another case.
            const { resource } = await connection.container
              .item(document.id, document.ID)
              .read<ReturnDocument>({
                abortSignal: AbortSignal.timeout(8_000),
              });
            if (
              !resource ||
              resource.submissionHash !== document.submissionHash
            )
              throw new HttpError(
                409,
                "This request identifier was already used. Start a new request.",
              );
          }
        } catch (error) {
          if (error instanceof HttpError) throw error;
          connection?.client.dispose();
          connection = undefined;
          if (Date.now() - lastLog >= 60_000) {
            lastLog = Date.now();
            try {
              await report(
                `Return request save failed. ${describeCosmosFailure(error, phase)} No receipt was issued; the site remains running.`,
              );
            } catch {
              /* Logging must not crash requests. */
            }
          }
          return unavailableReturns.submit(submission);
        }
      }
      return {
        reference: document.reference,
        status: "pending-review",
        localDevelopment: local,
      };
    },
    close() {
      closed = true;
      memory.clear();
      connection?.client.dispose();
      connection = undefined;
    },
  };
}
