import { cosmosSettings, createCosmosConnection } from "./cosmos.ts";
import { isLocalDevelopment } from "./content.ts";
import { describeCosmosFailure, logCosmosFailure } from "./logging.ts";
import { HttpError } from "./security.ts";

export type PrivateRecord = {
  id: string;
  ID: string;
  EntityType: string;
  [key: string]: unknown;
};
export interface PrivateRecords {
  local: boolean;
  create(document: PrivateRecord): Promise<void>;
  read(id: string): Promise<PrivateRecord | undefined>;
  replace(document: PrivateRecord, etag: string): Promise<void>;
  close(): void;
}
export function createPrivateRecords(
  env: Record<string, string | undefined>,
  connect = createCosmosConnection,
  report = logCosmosFailure,
): PrivateRecords {
  const local = isLocalDevelopment(env);
  const memory = new Map<string, { value: PrivateRecord; expires: number }>();
  let connection: ReturnType<typeof connect> | undefined;
  let closed = false;
  let lastLog = -Infinity;
  async function operation<T>(
    action: (connection: ReturnType<typeof connect>) => Promise<T>,
    phase: "write" | "query",
  ): Promise<T> {
    let stage: "configuration" | "client" | "write" | "query" = "configuration";
    try {
      if (closed) throw new Error("Store closed");
      if (!connection) {
        const settings = cosmosSettings(env);
        if (!settings) throw new Error("Missing configuration");
        stage = "client";
        connection = connect(settings);
      }
      stage = phase;
      return await action(connection);
    } catch (error) {
      const status = (error as { code?: number })?.code;
      if (status === 404 && phase === "query") return undefined as T;
      if (status === 409 || status === 412)
        throw new HttpError(status, "This record changed or already exists.");
      connection?.client.dispose();
      connection = undefined;
      if (Date.now() - lastLog > 60_000) {
        lastLog = Date.now();
        try {
          await report(
            `Private order/tracking storage unavailable. ${describeCosmosFailure(error, stage)} Site remains running.`,
          );
        } catch {
          /* No customer details or tokens in logs. */
        }
      }
      throw new HttpError(
        503,
        "Order and tracking services are temporarily unavailable. Please try again shortly.",
      );
    }
  }
  return {
    local,
    async create(document) {
      if (closed) throw new HttpError(503, "Tracking storage is unavailable.");
      if (local) {
        for (const [key, row] of memory)
          if (row.expires <= Date.now()) memory.delete(key);
        if (memory.has(document.id))
          throw new HttpError(409, "This record already exists.");
        if (memory.size >= 3000)
          throw new HttpError(
            503,
            "Local test storage is full. Restart the development server.",
          );
        memory.set(document.id, {
          value: { ...structuredClone(document), _etag: crypto.randomUUID() },
          expires: Date.now() + 86_400_000,
        });
        return;
      }
      await operation(async (conn) => {
        await conn.container.items.create(document, {
          abortSignal: AbortSignal.timeout(8_000),
        });
      }, "write");
    },
    async read(id) {
      if (closed) throw new HttpError(503, "Tracking storage is unavailable.");
      if (local) {
        const row = memory.get(id);
        if (row && row.expires > Date.now()) return structuredClone(row.value);
        memory.delete(id);
        return undefined;
      }
      return operation(
        async (conn) =>
          (
            await conn.container
              .item(id, id)
              .read<PrivateRecord>({ abortSignal: AbortSignal.timeout(8_000) })
          ).resource,
        "query",
      );
    },
    async replace(document, etag) {
      if (!etag)
        throw new HttpError(
          503,
          "A conditional update could not be performed.",
        );
      if (closed) throw new HttpError(503, "Storage is unavailable.");
      if (local) {
        const row = memory.get(document.id);
        if (!row || row.expires <= Date.now())
          throw new HttpError(503, "The record is unavailable.");
        if (row.value._etag !== etag)
          throw new HttpError(412, "The record changed.");
        memory.set(document.id, {
          value: { ...structuredClone(document), _etag: crypto.randomUUID() },
          expires: row.expires,
        });
        return;
      }
      const {
        _etag: _oldEtag,
        _rid,
        _self,
        _attachments,
        _ts,
        ...body
      } = document;
      await operation(async (conn) => {
        await conn.container
          .item(document.id, document.ID)
          .replace(body, {
            accessCondition: { type: "IfMatch", condition: etag },
            abortSignal: AbortSignal.timeout(8_000),
          });
      }, "write");
    },
    close() {
      closed = true;
      memory.clear();
      connection?.client.dispose();
      connection = undefined;
    },
  };
}
