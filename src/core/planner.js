import { PLANNER_PROVIDERS } from "../shared/settings.js";
import { createDeepSeekPlan } from "./deepseek-planner.js";
import { createFakePlan } from "./fake-planner.js";
import { createGatewayPlan } from "./gateway-planner.js";

export async function createPlan(inventory, settings) {
  if (settings.plannerProvider === PLANNER_PROVIDERS.GATEWAY) {
    return createGatewayPlan(inventory, settings);
  }
  if (settings.plannerProvider === PLANNER_PROVIDERS.DEEPSEEK) {
    return createDeepSeekPlan(inventory, settings);
  }
  return createFakePlan(inventory, settings);
}
