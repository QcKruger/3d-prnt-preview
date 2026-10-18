export const RETURN_HANDLING_FEE_PERCENT = 10;

export const returnReasons = {
  damaged: "Arrived broken or damaged",
  faulty: "Faulty or not working as expected",
  incorrect: "Wrong item received",
  description: "Item differs from its description",
  changedMind: "Changed my mind",
  other: "Another reason",
} as const;

export const returnResolutions = {
  replacement: "Replacement",
  refund: "Refund",
  advice: "Help deciding",
} as const;

export interface ReturnFields {
  name: string;
  email: string;
  orderReference: string;
  item: string;
  quantity: string;
  reason: string;
  description: string;
  resolution: string;
  consent: boolean;
}

export const initialReturn: ReturnFields = {
  name: "",
  email: "",
  orderReference: "",
  item: "",
  quantity: "1",
  reason: "",
  description: "",
  resolution: "advice",
  consent: false,
};

export type ReturnErrors = Partial<Record<keyof ReturnFields, string>>;
const validText = (s: unknown, min: number, max: number) =>
  typeof s === "string" &&
  s.trim().length >= min &&
  s.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s);

export function validateReturn(input: Partial<ReturnFields>): ReturnErrors {
  const errors: ReturnErrors = {};
  if (!validText(input.name, 2, 100))
    errors.name = "Enter your name (2–100 characters).";
  if (
    !validText(input.email, 3, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email?.trim() || "")
  )
    errors.email = "Enter a valid email address.";
  if (!validText(input.orderReference, 2, 120))
    errors.orderReference =
      "Enter your order or payment reference (2–120 characters).";
  if (!validText(input.item, 2, 200))
    errors.item = "Tell us which item you are returning (2–200 characters).";
  if (
    typeof input.quantity !== "string" ||
    !/^\d{1,3}$/.test(input.quantity) ||
    Number(input.quantity) < 1 ||
    Number(input.quantity) > 100
  )
    errors.quantity = "Enter a quantity between 1 and 100.";
  if (
    typeof input.reason !== "string" ||
    !Object.hasOwn(returnReasons, input.reason)
  )
    errors.reason = "Choose a reason for your return.";
  if (!validText(input.description, 20, 3000))
    errors.description = "Explain what happened (20–3,000 characters).";
  if (
    typeof input.resolution !== "string" ||
    !Object.hasOwn(returnResolutions, input.resolution)
  )
    errors.resolution = "Choose your preferred outcome.";
  if (input.consent !== true)
    errors.consent =
      "Acknowledge the 10% handling fee and confirm we may use these details to handle your request.";
  return errors;
}

export interface ReturnReceipt {
  reference: string;
  status: "pending-review";
  localDevelopment: boolean;
  tracking?: import("./tracking").TrackingAccess;
}
