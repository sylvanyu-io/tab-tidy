import { cp, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = new URL("..", import.meta.url).pathname;
const distDir = join(rootDir, "dist");
const extensionDir = join(distDir, "extension");
const manifest = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8"));
const zipName = `semantic-tab-agent-${manifest.version}.zip`;
const zipPath = join(distDir, zipName);

await rm(extensionDir, { recursive: true, force: true });
await mkdir(extensionDir, { recursive: true });

for (const path of ["manifest.json", "src"]) {
  await cp(join(rootDir, path), join(extensionDir, path), { recursive: true });
}

await rm(zipPath, { force: true });
const zip = spawnSync("zip", ["-qr", zipPath, "."], { cwd: extensionDir, stdio: "inherit" });
if (zip.status !== 0) {
  console.error("Failed to create extension zip. Ensure the `zip` command is available.");
  process.exit(zip.status || 1);
}

if (!existsSync(zipPath)) {
  console.error(`Expected zip was not created: ${zipPath}`);
  process.exit(1);
}

console.log(`Built ${zipPath}`);
console.log(`Unpacked extension: ${extensionDir}`);
