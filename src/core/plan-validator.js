import { EXISTING_GROUP_MODES, ORGANIZE_MODES, normalizeSettings } from "../shared/settings.js";

export const CHROME_GROUP_COLORS = Object.freeze(["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan"]);

export function validatePlan(plan, inventory, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const errors = [];
  const warnings = [];

  if (!plan || typeof plan !== "object") {
    return { ok: false, errors: ["Plan is missing."], warnings };
  }

  if (plan.schemaVersion !== 1) errors.push("Plan schemaVersion must be 1.");
  if (plan.mode !== settings.organizeMode) {
    errors.push(`Plan mode ${plan.mode || "<missing>"} does not match setting ${settings.organizeMode}.`);
  }

  const currentWindowId = inventory.scope?.currentWindowId;
  const plannerTabMap = new Map((inventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const lockedTabIds = new Set((inventory.lockedGroups || []).flatMap((group) => group.tabIds));
  const seen = new Map();

  for (const group of plan.groups || []) {
    validateGroup(group, settings, errors, warnings);
    for (const ref of group.tabRefs || []) {
      validateTabRef(ref, group.title || group.groupKey, {
        settings,
        currentWindowId,
        plannerTabMap,
        lockedTabIds,
        seen,
        errors
      });
    }
  }

  for (const ref of plan.reviewTabs || []) {
    validateTabRef(ref, "Review", {
      settings,
      currentWindowId,
      plannerTabMap,
      lockedTabIds,
      seen,
      errors
    });
  }

  for (const tab of plannerTabMap.values()) {
    if (!seen.has(tab.tabId)) {
      errors.push(`Eligible tab ${tab.tabId} is missing from both groups and Review.`);
    }
  }

  if (settings.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW) {
    for (const ref of [...collectGroupRefs(plan), ...(plan.reviewTabs || [])]) {
      if (ref.windowId !== currentWindowId) {
        errors.push(`Current-window mode cannot include tab ${ref.tabId} from window ${ref.windowId}.`);
      }
    }
  }

  if (settings.existingGroupMode === EXISTING_GROUP_MODES.PRESERVE) {
    const lockedSeen = [...seen.keys()].filter((tabId) => lockedTabIds.has(tabId));
    if (lockedSeen.length) {
      errors.push(`Preserved existing group tabs cannot be reassigned: ${lockedSeen.join(", ")}.`);
    }
  }

  const planExcludedIds = new Set((plan.excludedTabs || []).map((tab) => tab.tabId));
  for (const excluded of inventory.excludedTabs || []) {
    if (!planExcludedIds.has(excluded.tabId)) {
      warnings.push(`Excluded tab ${excluded.tabId} is not listed in plan.excludedTabs.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateGroup(group, settings, errors, warnings) {
  if (!group || typeof group !== "object") {
    errors.push("Group entry is invalid.");
    return;
  }
  if (!group.groupKey || typeof group.groupKey !== "string") errors.push("Group is missing groupKey.");
  if (!group.title || typeof group.title !== "string") errors.push(`Group ${group.groupKey || "<unknown>"} is missing title.`);
  if (group.title && group.title.length > 40) warnings.push(`Group title "${group.title}" may be too long for Chrome labels.`);
  if (!CHROME_GROUP_COLORS.includes(group.color)) errors.push(`Group ${group.title || group.groupKey} uses unsupported color ${group.color}.`);
  if (!Array.isArray(group.tabRefs)) errors.push(`Group ${group.title || group.groupKey} is missing tabRefs.`);
  if ((group.tabRefs || []).length > settings.maxTabsPerGroup && !String(group.reason || "").trim()) {
    warnings.push(`Group ${group.title} exceeds maxTabsPerGroup without an explicit reason.`);
  }
  if (Number(group.confidence) < settings.minConfidenceToApply) {
    warnings.push(`Group ${group.title} confidence is below the apply threshold.`);
  }
}

function validateTabRef(ref, owner, context) {
  const { settings, currentWindowId, plannerTabMap, lockedTabIds, seen, errors } = context;
  if (!ref || typeof ref.tabId !== "number" || typeof ref.windowId !== "number") {
    errors.push(`${owner} contains an invalid tab reference.`);
    return;
  }

  if (settings.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW && ref.windowId !== currentWindowId) {
    errors.push(`Tab ${ref.tabId} is outside the current window.`);
  }

  const inventoryTab = plannerTabMap.get(ref.tabId);
  if (!inventoryTab) {
    if (lockedTabIds.has(ref.tabId)) {
      errors.push(`Tab ${ref.tabId} belongs to a locked existing group.`);
    } else {
      errors.push(`Tab ${ref.tabId} does not exist in the eligible inventory.`);
    }
    return;
  }

  if (inventoryTab.windowId !== ref.windowId) {
    errors.push(`Tab ${ref.tabId} window mismatch: plan ${ref.windowId}, inventory ${inventoryTab.windowId}.`);
  }

  if (inventoryTab.pinned && !settings.includePinnedTabs) errors.push(`Pinned tab ${ref.tabId} is not allowed.`);
  if (inventoryTab.incognito && !settings.includeIncognitoTabs) errors.push(`Incognito tab ${ref.tabId} is not allowed.`);

  if (seen.has(ref.tabId)) {
    errors.push(`Tab ${ref.tabId} appears in both ${seen.get(ref.tabId)} and ${owner}.`);
  } else {
    seen.set(ref.tabId, owner);
  }
}

function collectGroupRefs(plan) {
  return (plan.groups || []).flatMap((group) => group.tabRefs || []);
}
