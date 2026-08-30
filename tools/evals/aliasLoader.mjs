/**
 * Resolve the repo's `@/*` TypeScript path alias for plain Node.
 *
 * The eval bridge imports Joblit's own server modules so it validates with the
 * same code production runs. Those modules import each other through `@/...`,
 * which Node cannot resolve on its own, and adding a TypeScript runner just for
 * this would mean a new entry in the dependency allowlist. Node 22+ strips
 * types natively; the only missing piece is the alias, and that is one hook.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Extensionless in source, so try the real file endings in turn.
 *
 * Existence is checked here rather than by catching `nextResolve`: resolution
 * of a missing path succeeds and only the later *load* fails, so a try/catch
 * around `nextResolve` never fires.
 */
function resolveWithExtensions(baseUrl, context, nextResolve) {
  // Extensions first: a bare path that happens to be a directory must fall
  // through to its index, not be handed to Node as a directory import.
  for (const candidate of [`${baseUrl}.ts`, `${baseUrl}.tsx`, `${baseUrl}/index.ts`, baseUrl]) {
    const path = fileURLToPath(candidate);
    if (existsSync(path) && statSync(path).isFile()) {
      return nextResolve(candidate, context);
    }
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(resolvePath(REPO_ROOT, specifier.slice(2))).href;
    const resolved = resolveWithExtensions(target, context, nextResolve);
    if (resolved) return resolved;
  }

  // TypeScript source also imports siblings extensionless ("./promptContract").
  if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
    const target = new URL(specifier, context.parentURL).href;
    const resolved = resolveWithExtensions(target, context, nextResolve);
    if (resolved) return resolved;
  }

  return nextResolve(specifier, context);
}
