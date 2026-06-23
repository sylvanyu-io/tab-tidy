import { stdout as output } from "node:process";
import { collectTabInventory } from "../src/core/tab-inventory.js";
import { createOpenAIPlan } from "../src/core/openai-planner.js";
import { validatePlan } from "../src/core/plan-validator.js";
import { buildPreview } from "../src/core/preview.js";
import { DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "../tests/helpers/fake-chrome.mjs";

const key = process.env.OPENAI_API_KEY || (await readKeyFromStdin());
if (!key) {
  console.error("Missing OPENAI_API_KEY.");
  process.exit(2);
}

const settings = {
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.OPENAI,
  openaiApiKey: key,
  openaiBaseUrl: process.env.OPENAI_BASE_URL || DEFAULT_SETTINGS.openaiBaseUrl,
  openaiModel: process.env.OPENAI_MODEL || DEFAULT_SETTINGS.openaiModel,
  customPrompt: "Prefer semantic topic grouping over domain grouping. Put uncertain tabs in Review."
};

const chrome = createFakeChrome({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [
        { id: 10, title: "OpenAI Structured Outputs", url: "https://developers.openai.com/api/docs/guides/structured-outputs", active: true },
        { id: 11, title: "Chrome tabGroups API", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" },
        { id: 12, title: "DeepSeek JSON Output docs", url: "https://api-docs.deepseek.com/guides/json_mode" },
        { id: 13, title: "GitHub pull request review", url: "https://github.com/example/project/pull/42" }
      ]
    }
  ]
});

const inventory = await collectTabInventory(chrome, settings, { windowId: 1 });
const plan = await createOpenAIPlan(inventory, settings);
const validation = validatePlan(plan, inventory, settings);
const preview = buildPreview(plan, inventory, validation, settings);

console.log(
  JSON.stringify(
    {
      provider: "openai",
      baseUrl: settings.openaiBaseUrl,
      model: settings.openaiModel,
      validation,
      preview: {
        groups: preview.groups,
        reviewTabsCount: preview.reviewTabsCount,
        excludedTabsCount: preview.excludedTabsCount,
        warnings: preview.warnings
      }
    },
    null,
    2
  )
);

process.exit(validation.ok ? 0 : 1);

async function readKeyFromStdin() {
  if (process.stdin.isTTY) {
    output.write("Provide OPENAI_API_KEY as an environment variable or pipe it on stdin.\n");
    return "";
  }

  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}
