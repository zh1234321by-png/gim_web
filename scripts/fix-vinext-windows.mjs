import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

if (process.platform !== "win32") {
  process.exit(0);
}

const target = path.resolve(
  "node_modules",
  "vinext",
  "dist",
  "server",
  "static-file-cache.js",
);
const original =
  "relativePath: path.relative(base, batch[j]),";
const replacement =
  'relativePath: path.relative(base, batch[j]).split(path.sep).join("/"),';

let source;
try {
  source = await readFile(target, "utf8");
} catch (error) {
  throw new Error(
    `Cannot locate Vinext static-file cache at ${target}. Run pnpm install first.`,
    { cause: error },
  );
}

if (source.includes(replacement)) {
  console.log("[SEGM] Vinext Windows static-path compatibility is ready.");
  process.exit(0);
}

if (!source.includes(original)) {
  throw new Error(
    "Unsupported Vinext version: Windows static-path patch target was not found.",
  );
}

await writeFile(target, source.replace(original, replacement), "utf8");
console.log("[SEGM] Applied Vinext Windows static-path compatibility fix.");
