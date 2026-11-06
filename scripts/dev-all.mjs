// npm run dev  ->  Next.js (http://localhost:3000) + local Steadfast functions (auto port, starts at 8899)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { startFunctionsServer } from "./local-functions.mjs";

const port = await startFunctionsServer(8899);
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "dev"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_FUNCTIONS_URL: `http://localhost:${port}/.netlify/functions` }
});
child.on("exit", code => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
