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
    const requestFailureCount = result.requestFailureCount ?? failedRequestCount(result.requests);
    const expectedTopics = expectedLabelByTabId(result.inventory, "topicByTabId");
    const storedFamilies = expectedLabelByTabId(result.inventory, "familyByTabId");
    const expectedFamilies = storedFamilies.size ? storedFamilies : familyLabelsFromTopics(expectedTopics);
    const predictedClusters = predictedClustersForResult(result);
    const topicMetrics = pairwiseMetrics(expectedTopics, predictedClusters);
    const familyMetrics = pairwiseMetrics(expectedFamilies, predictedClusters);
    const groupedCount = result.preview?.groupedTabsCount ?? groupedTabCount(predictedClusters);
    const reviewCount = result.preview?.reviewTabsCount ?? Math.max(0, expectedTopics.size - groupedCount);
    return {
      runId: payload.runId,
      partial: payload.partial,
      scenario: result.scenario || result.inventory?.benchmarkTruth?.scenario || "legacy_url_slug",
      dimensions: result.inventory?.benchmarkTruth?.dimensions || [],
      tabCount: result.tabCount,
      strategy: result.strategy,
      ok: Boolean(result.ok),
      degraded: Boolean(result.ok && (result.degraded || requestFailureCount > 0)),
      elapsedSeconds: result.elapsedSeconds,
      requestCount: result.requestCount,
      requestFailureCount,
      groups: result.preview?.groups?.length ?? "-",
      groupedCount,
      reviewCount,
      coverage: expectedTopics.size ? groupedCount / expectedTopics.size : 0,
      topicPrecision: topicMetrics.precision,
      topicRecall: topicMetrics.recall,
      topicF1: topicMetrics.f1,
      familyPrecision: familyMetrics.precision,
      familyRecall: familyMetrics.recall,
      familyF1: familyMetrics.f1,
      truePositive: topicMetrics.truePositive,
      predictedSame: topicMetrics.predictedSame,
      trueSame: topicMetrics.trueSame
    };
  });
}

function failedRequestCount(requests = []) {
  return (requests || []).filter((request) => request.ok === false).length;
}

function expectedLabelByTabId(inventory = {}, key) {
  if (inventory.benchmarkTruth?.[key] && typeof inventory.benchmarkTruth[key] === "object") {
    return new Map(
      Object.entries(inventory.benchmarkTruth[key])
        .map(([tabId, topic]) => [Number(tabId), String(topic || "")])
        .filter(([tabId, topic]) => Number.isInteger(tabId) && topic)
    );
  }
  const expected = new Map();
  for (const tab of inventory.plannerTabs || inventory.tabs || []) {
    const topic = inferTopic(tab);
    if (topic) expected.set(tab.tabId, topic);
  }
  return expected;
}

function familyLabelsFromTopics(expectedTopics) {
  return new Map([...expectedTopics.entries()].map(([tabId, topic]) => [tabId, familyForTopic(topic)]));
}

function familyForTopic(topic) {
  const families = {
    "ai-coding": "ai-work",
    "llm-evals": "ai-work",
    "chrome-extension": "extension-build",
    frontend: "extension-build",
    cloudflare: "infra-data",
    data: "infra-data",
    design: "product-reference",
    reading: "product-reference",
    video: "product-reference",
    finance: "account-work"
  };
  return families[topic] || topic;
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
    "This report evaluates synthetic benchmark outputs against explicit fixture truth when available, with URL-path inference kept only for older benchmark files. Review tabs are treated as singleton clusters, so coverage and recall drop when the planner leaves tabs for manual confirmation.",
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
    "| Run | Scenario | Tabs | Strategy | Status | Time | Requests | Groups | Coverage | Topic Precision | Topic Recall | Topic F1 | Family F1 |",
    "| --- | --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  );

  for (const report of reports) {
    for (const row of report.rows) {
      lines.push(
        [
          basename(report.inputPath),
          row.scenario,
          row.tabCount,
          row.strategy,
          row.degraded ? "degraded" : row.ok ? "ok" : "failed",
          `${row.elapsedSeconds.toFixed(1)}s`,
          row.requestFailureCount ? `${row.requestCount} (${row.requestFailureCount} failed)` : row.requestCount,
          row.groups,
          formatPercent(row.coverage),
          formatPercent(row.topicPrecision),
          formatPercent(row.topicRecall),
          formatPercent(row.topicF1),
          formatPercent(row.familyF1)
        ].join(" | ").replace(/^/, "| ").replace(/$/, " |")
      );
    }
  }

  lines.push(
    "",
    "## Reading The Numbers",
    "",
    "- Topic precision answers: when Tab Tidy puts two tabs in the same group, how often do they share the fine-grained synthetic topic?",
    "- Topic recall answers: among tabs that share a fine-grained synthetic topic, how often did Tab Tidy keep them together?",
    "- Family F1 is a coarser workflow-level score. It helps distinguish useful broad grouping from genuinely wrong mixed groups.",
    "- Coverage is not accuracy. Higher review counts can improve safety but reduce automatic organization completeness.",
    "- New benchmark files can carry explicit `benchmarkTruth.topicByTabId`; older files fall back to URL path inference.",
    "- These are synthetic fixtures. They are useful for regression testing planner behavior, not a substitute for real browsing-session review."
  );

  return `${lines.join("\n")}\n`;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
