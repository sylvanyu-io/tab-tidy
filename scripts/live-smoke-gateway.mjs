import { collectTabInventory } from "../src/core/tab-inventory.js";
import { createGatewayPlan } from "../src/core/gateway-planner.js";
import { validatePlan } from "../src/core/plan-validator.js";
import { buildPreview } from "../src/core/preview.js";
import { BUILTIN_GATEWAY_BASE_URL, DEFAULT_SETTINGS, PLANNER_PROVIDERS } from "../src/shared/settings.js";
import { createFakeChrome } from "../tests/helpers/fake-chrome.mjs";

const key = process.env.GATEWAY_API_KEY || "";

const settings = {
  ...DEFAULT_SETTINGS,
  plannerProvider: PLANNER_PROVIDERS.GATEWAY,
  gatewayApiKey: key,
  gatewayBaseUrl: process.env.GATEWAY_BASE_URL || BUILTIN_GATEWAY_BASE_URL,
  gatewayModel: process.env.GATEWAY_MODEL || DEFAULT_SETTINGS.gatewayModel,
  gatewayThinkingIntensity: process.env.GATEWAY_THINKING_INTENSITY || DEFAULT_SETTINGS.gatewayThinkingIntensity,
  customPrompt: "Prefer semantic topic grouping over domain grouping. Put uncertain tabs in Review."
};

const chrome = createFakeChrome({
  windows: [
    {
      id: 1,
      focused: true,
      tabs: [
        { id: 10, title: "Structured output docs", url: "https://developers.openai.com/api/docs/guides/structured-outputs", active: true },
        { id: 11, title: "Chrome tabGroups API", url: "https://developer.chrome.com/docs/extensions/reference/api/tabGroups" },
        { id: 12, title: "JSON Output docs", url: "https://example.com/json-output" },
        { id: 13, title: "GitHub pull request review", url: "https://github.com/example/project/pull/42" }
      ]
    }
  ]
});

const inventory = await collectTabInventory(chrome, settings, { windowId: 1 });
const plan = await createGatewayPlan(inventory, settings);
const validation = validatePlan(plan, inventory, settings);
const preview = buildPreview(plan, inventory, validation, settings);

console.log(
  JSON.stringify(
    {
      provider: "gateway",
      baseUrl: settings.gatewayBaseUrl,
      model: settings.gatewayModel,
      thinkingIntensity: settings.gatewayThinkingIntensity,
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
