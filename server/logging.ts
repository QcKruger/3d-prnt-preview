import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

// Callers supply controlled messages, never raw provider errors or credentials.
export async function logCosmosFailure(message: string): Promise<void> {
  const entry = `${new Date().toISOString()} [Cosmos] ${message}`;
  console.error(entry);
  // IISNode stdout capture is disabled. Keep an operational log outside wwwroot
  // on Azure's writable home volume instead of inside the deployment package.
  if (process.env.WEBSITE_SITE_NAME && process.env.HOME) {
    try {
      const directory = join(process.env.HOME, "LogFiles", "3dprnt");
      await mkdir(directory, { recursive: true });
      await appendFile(join(directory, "cosmos.log"), entry + "\n", "utf8");
    } catch {
      console.error("[Cosmos] Could not write the Azure operational log.");
    }
  }
}
