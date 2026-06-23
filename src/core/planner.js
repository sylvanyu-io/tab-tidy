import { PLANNER_PROVIDERS } from "../shared/settings.js";
import { createFakePlan } from "./fake-planner.js";
import { createOpenAIPlan } from "./openai-planner.js";

export async function createPlan(inventory, settings) {
  if (settings.plannerProvider === PLANNER_PROVIDERS.OPENAI) {
    return createOpenAIPlan(inventory, settings);
  }
  return createFakePlan(inventory, settings);
}
