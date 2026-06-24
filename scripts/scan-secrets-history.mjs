import { spawnSync } from "node:child_process";

const secretPatterns = [
  {
    name: "provider_api_key",
    pattern: /\b(?:sk|sk-ant|sk-or|sk-proj)-[A-Za-z0-9_-]{20,}\b/g
  }
];

const gitLog = spawnSync("git", ["log", "-p", "--all", "--", "."], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024
});

if (gitLog.status !== 0) {
  console.error(gitLog.stderr || "Unable to scan git history.");
  process.exit(gitLog.status || 1);
}

const findings = [];
for (const rule of secretPatterns) {
  for (const match of gitLog.stdout.matchAll(rule.pattern)) {
    findings.push({ rule: rule.name, offset: match.index });
  }
}

if (findings.length) {
  console.error("Potential secrets found in git history:");
  for (const finding of findings.slice(0, 20)) {
    console.error(`- ${finding.rule} near history offset ${finding.offset}`);
  }
  if (findings.length > 20) {
    console.error(`- ${findings.length - 20} additional finding(s) omitted.`);
  }
  process.exit(1);
}

console.log("No provider-key patterns found in git history.");
