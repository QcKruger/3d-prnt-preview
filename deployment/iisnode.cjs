// IISNode loads a CommonJS entry point; Node 24 runs the TypeScript backend.
import("./server/start.ts").catch(() => {
  console.error(
    "Application startup failed. Check Cosmos identity, permissions, networking and server settings.",
  );
  process.exit(1);
});
