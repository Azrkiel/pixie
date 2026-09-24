import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const common = { bundle: true, sourcemap: true, target: "es2022", logLevel: "info" };

await Promise.all([
  build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload/preload.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/renderer/main.ts"], outfile: "dist/renderer/main.js", platform: "browser", format: "iife" }),
]);

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
