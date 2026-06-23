import { readFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const rootDir = new URL("..", import.meta.url).pathname;
const ignoredDirs = new Set([".git", "node_modules", "dist", "test-results", "playwright-report", "coverage"]);
const secretPatterns = [
  {
    name: "provider_api_key",
    pattern: /\b(?:sk|sk-ant|sk-or|sk-proj)-[A-Za-z0-9_-]{20,}\b/g
  }
];

const findings = [];
for (const filePath of walk(rootDir)) {
  const text = await readFile(filePath, "utf8").catch(() => "");
  for (const rule of secretPatterns) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({
        file: relative(rootDir, filePath),
        rule: rule.name,
        offset: match.index
      });
    }
  }
}

if (findings.length) {
  console.error("Potential secrets found:");
  for (const finding of findings) {
    console.error(`- ${finding.file} (${finding.rule} at ${finding.offset})`);
  }
  process.exit(1);
}

console.log("No provider-key patterns found.");

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoredDirs.has(entry)) continue;
    const filePath = join(dir, entry);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      yield* walk(filePath);
    } else if (stat.isFile()) {
      yield filePath;
    }
  }
}
