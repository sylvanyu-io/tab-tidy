import { PLANNER_PROVIDERS } from "../shared/settings.js";
import { createDeepSeekPlan } from "./deepseek-planner.js";
import { createFakePlan } from "./fake-planner.js";
import { createGatewayPlan } from "./gateway-planner.js";

export async function createPlan(inventory, settings, options = {}) {
  if (settings.plannerProvider === PLANNER_PROVIDERS.GATEWAY) {
    return createGatewayPlan(inventory, settings, globalThis.fetch, options);
  }
  if (settings.plannerProvider === PLANNER_PROVIDERS.DEEPSEEK) {
    return createDeepSeekPlan(inventory, settings, globalThis.fetch, options);
  }
  return createFakePlan(inventory, settings);
}
