import { CHROME_GROUP_COLORS } from "./plan-validator.js";

const tabRefSchema = {
  type: "object",
  additionalProperties: false,
  required: ["tabId", "windowId"],
  properties: {
    tabId: { type: "number" },
    windowId: { type: "number" }
  }
};

export const ACTION_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "mode", "scope", "targetWindow", "eligibleTabs", "excludedTabs", "groups", "reviewTabs"],
  properties: {
    schemaVersion: { type: "number", enum: [1] },
    mode: { type: "string", enum: ["current_window", "consolidate_one_window"] },
    scope: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "windowIds"],
      properties: {
        kind: { type: "string", enum: ["current_window", "all_normal_windows"] },
        windowIds: { type: "array", items: { type: "number" } }
      }
    },
    targetWindow: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "windowId", "title"],
      properties: {
        kind: { type: "string", enum: ["new_window", "current_window", "selected_window"] },
        windowId: { type: ["number", "null"] },
        title: { type: "string" }
      }
    },
    eligibleTabs: { type: "array", items: tabRefSchema },
    excludedTabs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tabId", "windowId", "reason"],
        properties: {
          tabId: { type: "number" },
          windowId: { type: "number" },
          reason: { type: "string" }
        }
      }
    },
    groups: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["groupKey", "title", "color", "confidence", "tabRefs", "reason"],
        properties: {
          groupKey: { type: "string" },
          title: { type: "string" },
          color: { type: "string", enum: CHROME_GROUP_COLORS },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          tabRefs: { type: "array", items: tabRefSchema },
          reason: { type: "string" }
        }
      }
    },
    reviewTabs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["tabId", "windowId", "reason"],
        properties: {
          tabId: { type: "number" },
          windowId: { type: "number" },
          reason: { type: "string" }
        }
      }
    }
  }
};
