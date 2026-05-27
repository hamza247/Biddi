import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const outFile = path.join(dir, "dist-seed", "seed-heatmap.mjs");

mkdirSync(path.join(dir, "dist-seed"), { recursive: true });

await build({
  entryPoints: [path.join(dir, "src/scripts/seed-heatmap.ts")],
  platform: "node",
  bundle: true,
  format: "esm",
  outfile: outFile,
  logLevel: "warning",
  external: ["*.node", "pg-native"],
  banner: {
    js: `import { createRequire as __crReq } from 'node:module';
import __bPath from 'node:path';
import __bUrl from 'node:url';
globalThis.require = __crReq(import.meta.url);
globalThis.__filename = __bUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bPath.dirname(globalThis.__filename);
`,
  },
});

const args = process.argv.slice(2);
const result = spawnSync("node", [outFile, ...args], { stdio: "inherit" });
process.exit(result.status ?? 0);
