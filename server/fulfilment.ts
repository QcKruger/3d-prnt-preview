import { provinces } from "../src/fulfilment.ts";
import type {
  FulfilmentConfig,
  SavedFulfilment,
  DeliveryAddress,
} from "../src/fulfilment.ts";
import { HttpError } from "./security.ts";

export function fulfilmentSettings(
  env: Record<string, string | undefined>,
): FulfilmentConfig {
  const fee = env.DELIVERY_FEE_CENTS ?? "9900";
  if (!/^\d+$/.test(fee) || Number(fee) > 1_000_000)
    throw new Error(
      "DELIVERY_FEE_CENTS must be an integer between 0 and 1000000.",
    );
  if (env.DELIVERY_ENABLED && !["true", "false"].includes(env.DELIVERY_ENABLED))
    throw new Error("DELIVERY_ENABLED must be true or false.");
  const coverage = env.DELIVERY_PROVINCES?.split(",").map((s) => s.trim()) ?? [
    ...provinces,
  ];
  if (
    !coverage.length ||
    coverage.some((s) => !provinces.includes(s as (typeof provinces)[number]))
  )
    throw new Error(
      "DELIVERY_PROVINCES must contain South African province names separated by commas.",
    );
  const text = (name: string, fallback: string) => {
    const value = env[name]?.trim() || fallback;
    if (value.length > 500 || /[\u0000-\u001f\u007f]/.test(value))
      throw new Error(`Invalid ${name}.`);
    return value;
  };
  return {
    deliveryEnabled: env.DELIVERY_ENABLED !== "false",
    deliveryFeeCents: Number(fee),
    deliveryProvinces: [...new Set(coverage)],
    deliveryEstimate: text(
      "DELIVERY_ESTIMATE",
      "Estimated 3–5 business days after dispatch; remote areas may take longer.",
    ),
    collectionAddress: text(
      "COLLECTION_ADDRESS",
      "Collection location will be confirmed by the studio.",
    ),
    collectionHours: text(
      "COLLECTION_HOURS",
      "By arrangement. Wait for confirmation before travelling.",
    ),
  };
}
export function parseFulfilment(
  input: unknown,
  config: FulfilmentConfig,
): SavedFulfilment {
  // Preserve collection for existing clients which have no fulfilment selection.
  const choice = input === undefined ? { method: "collection" } : input;
  if (!choice || typeof choice !== "object" || Array.isArray(choice))
    throw new HttpError(400, "Choose collection or delivery.");
  const data = choice as Record<string, unknown>;
  if (data.method === "collection")
    return {
      method: "collection",
      feeCents: 0,
      status: "awaiting-payment-verification",
      collectionAddress: config.collectionAddress,
      collectionHours: config.collectionHours,
    };
  if (data.method !== "delivery" || !config.deliveryEnabled)
    throw new HttpError(400, "Delivery is not available. Choose collection.");
  if (
    !data.address ||
    typeof data.address !== "object" ||
    Array.isArray(data.address)
  )
    throw new HttpError(400, "Enter a delivery address.");
  const source = data.address as Record<string, unknown>;
  const address: Record<string, string> = {};
  for (const [field, limit] of Object.entries({
    recipient: 100,
    phone: 30,
    street: 200,
    suburb: 100,
    city: 100,
    province: 30,
    postalCode: 4,
  })) {
    const value = source[field];
    if (
      typeof value !== "string" ||
      value.length > limit ||
      /[\u0000-\u001f\u007f]/.test(value) ||
      (field !== "suburb" && !value.trim())
    )
      throw new HttpError(400, `Enter a valid delivery ${field}.`);
    address[field] = value.trim();
  }
  if (
    source.country !== "ZA" ||
    !config.deliveryProvinces.includes(address.province) ||
    !/^\d{4}$/.test(address.postalCode) ||
    !/^(?:0\d{9}|\+27\d{9})$/.test(address.phone.replace(/[ ()-]/g, ""))
  )
    throw new HttpError(
      400,
      "Use a South African address in a supported province, a four-digit postal code and a valid South African phone number.",
    );
  return {
    method: "delivery",
    address: { ...address, country: "ZA" } as unknown as DeliveryAddress,
    feeCents: config.deliveryFeeCents,
    status: "awaiting-payment-verification",
    deliveryEstimate: config.deliveryEstimate,
  };
}
