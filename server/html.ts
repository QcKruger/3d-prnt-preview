import type { ServerResponse } from "node:http";

// Vite emits this placeholder in scripts/styles; it is replaced for EACH response.
export const NONCE_PLACEHOLDER = "APP_CSP_NONCE_PLACEHOLDER_VALUE___";

export function sendHtml(response: ServerResponse, template: string) {
  const policy = String(response.getHeader("Content-Security-Policy") || "");
  const nonce = policy.match(/'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
  if (!nonce) throw new Error("Missing response nonce.");
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(template.replaceAll(NONCE_PLACEHOLDER, nonce));
}
