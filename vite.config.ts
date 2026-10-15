import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { paymentPlugin } from "./server/vite-plugin.ts";
import { NONCE_PLACEHOLDER } from "./server/html.ts";

export default defineConfig({
  plugins: [react(), paymentPlugin()],
  base: "./",
  html: { cspNonce: NONCE_PLACEHOLDER },
  server: { host: "127.0.0.1", cors: false, fs: { strict: true } },
  preview: { host: "127.0.0.1", cors: false },
  build: { sourcemap: false },
});
