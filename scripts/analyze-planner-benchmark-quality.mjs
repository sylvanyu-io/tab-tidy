import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const inputPaths = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const outputArg = process.argv.find((arg) => arg.startsWith("--output="));
const outputPath = outputArg ? outputArg.slice("--output=".length) : "";

if (!inputPaths.length) {
  console.error("Usage: node scripts/analyze-planner-benchmark-quality.mjs <benchmark.json...> [--output=docs/benchmarks/report.md]");
  process.exit(1);
}

const reports = [];
for (const inputPath of inputPaths) {
  const payload = JSON.parse(await readFile(inputPath, "utf8"));
  reports.push({ inputPath, payload, rows: analyzePayload(payload) });
}

const markdown = renderMarkdown(reports);
if (outputPath) {
  await writeFile(outputPath, markdown);
} else {
  process.stdout.write(markdown);
}

function analyzePayload(payload) {
  return (payload.results || []).map((result) => {
    const expectedTopics = expectedTopicByTabId(result.inventory);
    const predictedClusters = predictedClustersForResult(result);
    const metrics = pairwiseMetrics(expectedTopics, predictedClusters);
    const groupedCount = result.preview?.groupedTabsCount ?? groupedTabCount(predictedClusters);
    const reviewCount = result.preview?.reviewTabsCount ?? Math.max(0, expectedTopics.size - groupedCount);
    return {
      runId: payload.runId,
      partial: payload.partial,
      tabCount: result.tabCount,
      strategy: result.strategy,
      ok: Boolean(result.ok),
      elapsedSeconds: result.elapsedSeconds,
      requestCount: result.requestCount,
      groups: result.preview?.groups?.length ?? "-",
      groupedCount,
      reviewCount,
      coverage: expectedTopics.size ? groupedCount / expectedTopics.size : 0,
      ...metrics
    };
  });
}

function expectedTopicByTabId(inventory = {}) {
  const expected = new Map();
  for (const tab of inventory.plannerTabs || inventory.tabs || []) {
    const topic = inferTopic(tab);
    if (topic) expected.set(tab.tabId, topic);
  }
  return expected;
}

function inferTopic(tab) {
  const url = tab?.sanitizedUrl || "";
  const match = url.match(/^https?:\/\/[^/]+\/([^/?#]+)/);
  if (match) return match[1];
  return "";
}

function predictedClustersForResult(result) {
  const clusters = [];
  for (const group of result.plan?.groups || result.preview?.groups || []) {
    const refs = Array.isArray(group.tabRefs)
      ? group.tabRefs
      : Array.isArray(group.tabs)
        ? group.tabs
        : [];
    const ids = refs.map((ref) => ref.tabId).filter((id) => Number.isInteger(id));
    if (ids.length) clusters.push(ids);
  }
  for (const ref of result.plan?.reviewTabs || []) {
    if (Number.isInteger(ref.tabId)) clusters.push([ref.tabId]);
  }
  return clusters;
}

function pairwiseMetrics(expectedTopics, predictedClusters) {
  let predictedSame = 0;
  let trueSame = 0;
  let truePositive = 0;
  const ids = [...expectedTopics.keys()].sort((left, right) => left - right);
  const clusterIdByTabId = new Map();

  predictedClusters.forEach((cluster, clusterIndex) => {
    for (const id of cluster) {
      if (!clusterIdByTabId.has(id)) clusterIdByTabId.set(id, clusterIndex);
    }
  });

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const left = ids[i];
      const right = ids[j];
      const sameExpected = expectedTopics.get(left) === expectedTopics.get(right);
      const samePredicted = clusterIdByTabId.get(left) !== undefined && clusterIdByTabId.get(left) === clusterIdByTabId.get(right);
      if (sameExpected) trueSame += 1;
      if (samePredicted) predictedSame += 1;
      if (sameExpected && samePredicted) truePositive += 1;
    }
  }

  const precision = predictedSame ? truePositive / predictedSame : 0;
  const recall = trueSame ? truePositive / trueSame : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, truePositive, predictedSame, trueSame };
}

function groupedTabCount(predictedClusters) {
  return predictedClusters.filter((cluster) => cluster.length > 1).reduce((sum, cluster) => sum + cluster.length, 0);
}

function renderMarkdown(reports) {
  const lines = [
    "# Planner Benchmark Quality Analysis",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "This report evaluates synthetic benchmark outputs against known topic slugs embedded in synthetic URLs. Review tabs are treated as singleton clusters, so coverage and pairwise recall drop when the planner leaves tabs for manual confirmation.",
    "",
    "## Inputs",
    ""
  ];

  for (const report of reports) {
    lines.push(`- \`${report.inputPath}\` (${report.payload.runId}, partial: ${Boolean(report.payload.partial)})`);
  }

  lines.push(
    "",
    "## Metrics",
    "",
    "| Run | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Pair Precision | Pair Recall | Pair F1 |",
    "| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  );

  for (const report of reports) {
    for (const row of report.rows) {
      lines.push(
        [
          basename(report.inputPath),
          row.tabCount,
          row.strategy,
          row.ok ? "ok" : "failed",
          `${row.elapsedSeconds.toFixed(1)}s`,
          row.requestCount,
          row.groups,
          formatPercent(row.coverage),
          formatPercent(row.precision),
          formatPercent(row.recall),
          formatPercent(row.f1)
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
      );
    }
  }

  lines.push(
    "",
    "## Reading The Numbers",
    "",
    "- Pair precision answers: when Tab Tidy puts two tabs in the same group, how often do they share the synthetic ground-truth topic?",
    "- Pair recall answers: among tabs that share a ground-truth topic, how often did Tab Tidy keep them together?",
    "- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.",
    "- These are synthetic metadata-only fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review."
  );

  return `${lines.join("\n")}\n`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
