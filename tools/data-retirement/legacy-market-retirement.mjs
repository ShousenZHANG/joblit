#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(toolDirectory, "..", "..");
const jiti = createJiti(import.meta.url, {
  alias: { "@": repositoryRoot },
  fsCache: false,
});
globalThis.__JOBLIT_RUN_LEGACY_MARKET_RETIREMENT__ = true;
await jiti.import(
  join(toolDirectory, "retire-legacy-markets.ts"),
);
delete globalThis.__JOBLIT_RUN_LEGACY_MARKET_RETIREMENT__;
