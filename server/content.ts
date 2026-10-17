import { emptyContent } from "../src/content.ts";
import type { StorefrontContent } from "../src/content.ts";
import type { ProductShape } from "../src/types.ts";
import { cosmosSettings, createCosmosConnection } from "./cosmos.ts";
import { describeCosmosFailure, logCosmosFailure } from "./logging.ts";
import type { CosmosPhase } from "./logging.ts";

export interface ContentResult {
  available: boolean;
  content: StorefrontContent;
}
export interface ContentSource {
  get(): Promise<ContentResult>;
  close(): void;
}
type Environment = Record<string, string | undefined>;

export function isLocalDevelopment(env: Environment): boolean {
  return (
    env.NODE_ENV === "development" &&
    !(
      env.WEBSITE_SITE_NAME ||
      env.WEBSITE_INSTANCE_ID ||
      env.IDENTITY_ENDPOINT ||
      env.MSI_ENDPOINT ||
      env.CONTAINER_APP_NAME ||
      env.APP_ORIGIN
    ) &&
    ["localhost", "127.0.0.1", "::1"].includes(env.HOST || "127.0.0.1")
  );
}

const shapes = new Set([
  "planter",
  "stand",
  "dragon",
  "cable",
  "sign",
  "vase",
  "controller",
  "key",
]);
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= limit &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

// Quoted JSON projections and bracket access also support reserved SQL names
// such as "value" and "desc". Do not interpolate request-supplied fields here.
const publicContentQuery = `SELECT TOP 1000 VALUE {
  "id": c["id"], "EntityType": c["EntityType"],
  "schemaVersion": c["schemaVersion"], "sortOrder": c["sortOrder"],
  "productId": c["productId"], "name": c["name"],
  "category": c["category"], "priceCents": c["priceCents"],
  "currency": c["currency"], "desc": c["desc"],
  "color": c["color"], "shape": c["shape"], "tag": c["tag"],
  "value": c["value"], "label": c["label"],
  "question": c["question"], "answer": c["answer"],
  "title": c["title"], "description": c["description"], "icon": c["icon"]
} FROM c WHERE c["EntityType"] IN ('Product', 'Category', 'Faq', 'Service', 'ProcessStep')`;

// Explicitly project and validate public content; never return raw Cosmos items.
export function parseContent(records: unknown[]): StorefrontContent {
  const content = emptyContent();
  const ordered = records
    .filter(
      (value): value is Record<string, unknown> =>
        !!value && typeof value === "object" && !Array.isArray(value),
    )
    .sort(
      (a, b) =>
        (typeof a.sortOrder === "number" ? a.sortOrder : 0) -
          (typeof b.sortOrder === "number" ? b.sortOrder : 0) ||
        String(a.id).localeCompare(String(b.id)),
    );
  const used = new Set<string>();
  const productCounts = new Map<number, number>();
  for (const record of ordered)
    if (record.EntityType === "Product" && typeof record.productId === "number")
      productCounts.set(
        record.productId,
        (productCounts.get(record.productId) || 0) + 1,
      );
  for (const d of ordered) {
    if (d.schemaVersion !== 1 || !text(d.id, 150) || used.has(d.id)) continue;
    used.add(d.id);
    if (d.EntityType === "Product") {
      if (
        typeof d.productId !== "number" ||
        !Number.isSafeInteger(d.productId) ||
        d.productId < 1 ||
        productCounts.get(d.productId) !== 1 ||
        !text(d.name, 120) ||
        !text(d.category, 80) ||
        !text(d.desc, 2000) ||
        !text(d.tag, 40) ||
        typeof d.color !== "string" ||
        !/^#[a-f\d]{6}$/i.test(d.color) ||
        typeof d.shape !== "string" ||
        !shapes.has(d.shape) ||
        d.currency !== "ZAR" ||
        typeof d.priceCents !== "number" ||
        !Number.isSafeInteger(d.priceCents) ||
        d.priceCents < 1 ||
        d.priceCents > 100_000_000
      )
        continue;
      content.products.push({
        id: d.productId,
        name: d.name,
        category: d.category,
        price: d.priceCents / 100,
        desc: d.desc,
        color: d.color,
        shape: d.shape as ProductShape,
        tag: d.tag,
      });
    } else if (
      d.EntityType === "Category" &&
      text(d.value, 80) &&
      d.value !== "All" &&
      text(d.label, 100)
    ) {
      if (!content.categories.some((c) => c.value === d.value))
        content.categories.push({ value: d.value, label: d.label });
    } else if (
      d.EntityType === "Faq" &&
      text(d.question, 300) &&
      text(d.answer, 4000)
    ) {
      content.faqs.push({ id: d.id, question: d.question, answer: d.answer });
    } else if (
      d.EntityType === "Service" &&
      text(d.title, 150) &&
      text(d.description, 2000) &&
      text(d.icon, 10)
    ) {
      content.services.push({
        id: d.id,
        title: d.title,
        description: d.description,
        icon: d.icon,
      });
    } else if (
      d.EntityType === "ProcessStep" &&
      text(d.title, 150) &&
      text(d.description, 2000)
    ) {
      content.processSteps.push({
        id: d.id,
        title: d.title,
        description: d.description,
      });
    }
  }
  return content;
}

export const unavailableContent: ContentSource = {
  get: async () => ({ available: false, content: emptyContent() }),
  close() {},
};

export function createContentSource(
  env: Environment,
  connect = createCosmosConnection,
  report: (message: string) => void | Promise<void> = logCosmosFailure,
): ContentSource {
  let connection: ReturnType<typeof createCosmosConnection> | undefined;
  let pending: Promise<ContentResult> | undefined;
  let lastLog = -Infinity;
  let closed = false;
  let wasUnavailable = false;
  let loggedSuccess = false;
  const load = async (): Promise<ContentResult> => {
    if (isLocalDevelopment(env)) {
      // This module and all seed content are excluded from the deployed package.
      const { localContent } = await import("./local-content.ts");
      return { available: true, content: localContent };
    }
    let phase: CosmosPhase = "configuration";
    try {
      if (!connection) {
        const settings = cosmosSettings(env);
        if (!settings) throw new Error("Missing data configuration");
        phase = "client";
        connection = connect(settings);
      }
      phase = "query";
      const { resources } = await connection.container.items
        .query<unknown>(publicContentQuery, {
          maxItemCount: 100,
          abortSignal: AbortSignal.timeout(8_000),
        })
        .fetchAll();
      phase = "validation";
      const content = parseContent(resources);
      if (!loggedSuccess || wasUnavailable) {
        const counts = Object.entries(content)
          .map(([name, rows]) => `${name}=${rows.length}`)
          .join(" ");
        try {
          await report(
            `Content read succeeded. records=${resources.length} ${counts}. ${resources.length === 0 ? "Query returned no matching EntityType records." : "Only schemaVersion=1 records passing public-content validation are displayed."}`,
          );
        } catch {
          /* Logging cannot interrupt content delivery. */
        }
        loggedSuccess = true;
      }
      wasUnavailable = false;
      return { available: true, content };
    } catch (error) {
      connection?.client.dispose();
      connection = undefined;
      wasUnavailable = true;
      if (Date.now() - lastLog >= 60_000) {
        lastLog = Date.now();
        try {
          await report(
            `Content unavailable. ${describeCosmosFailure(error, phase)} Site remains running; retrying on the next content request. Repeated failures are logged at most once per minute.`,
          );
        } catch {
          /* Logging cannot interrupt the site or its recovery. */
        }
      }
      return { available: false, content: emptyContent() };
    }
  };
  return {
    get() {
      if (closed) return unavailableContent.get();
      if (!pending)
        pending = load().finally(() => {
          pending = undefined;
        });
      return pending;
    },
    close() {
      closed = true;
      connection?.client.dispose();
      connection = undefined;
    },
  };
}
