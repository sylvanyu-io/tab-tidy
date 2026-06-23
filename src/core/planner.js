import { PLANNER_PROVIDERS } from "../shared/settings.js";
import { createFakePlan } from "./fake-planner.js";
import { createGatewayPlan } from "./gateway-planner.js";

export async function createPlan(inventory, settings, options = {}) {
  if (settings.plannerProvider === PLANNER_PROVIDERS.GATEWAY) {
    return createGatewayPlan(inventory, settings, globalThis.fetch, options);
  }
  return createFakePlan(inventory, settings);
}
