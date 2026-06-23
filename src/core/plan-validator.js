import { EXISTING_GROUP_MODES, ORGANIZE_MODES, TARGET_WINDOW_MODES, normalizeSettings } from "../shared/settings.js";

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
  validateTargetWindow(plan.targetWindow, settings, inventory.scope || {}, errors);
  const plannerTabMap = new Map((inventory.plannerTabs || []).map((tab) => [tab.tabId, tab]));
  const lockedTabIds = new Set((inventory.lockedGroups || []).flatMap((group) => group.tabIds));
  const seen = new Map();
  const groups = Array.isArray(plan.groups) ? plan.groups : [];
  const reviewTabs = Array.isArray(plan.reviewTabs) ? plan.reviewTabs : [];
  const excludedTabs = Array.isArray(plan.excludedTabs) ? plan.excludedTabs : [];

  if (!Array.isArray(plan.groups)) errors.push("Plan groups must be an array.");
  if (!Array.isArray(plan.reviewTabs)) errors.push("Plan reviewTabs must be an array.");
  if (!Array.isArray(plan.excludedTabs)) errors.push("Plan excludedTabs must be an array.");

  for (const group of groups) {
    validateGroup(group, settings, errors, warnings);
    const tabRefs = Array.isArray(group?.tabRefs) ? group.tabRefs : [];
    for (const ref of tabRefs) {
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

  for (const ref of reviewTabs) {
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
    for (const ref of [...collectGroupRefs(groups), ...reviewTabs]) {
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

  const planExcludedIds = new Set(excludedTabs.map((tab) => tab.tabId));
  for (const excluded of inventory.excludedTabs || []) {
    if (!planExcludedIds.has(excluded.tabId)) {
      warnings.push(`Excluded tab ${excluded.tabId} is not listed in plan.excludedTabs.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

function validateTargetWindow(targetWindow, settings, scope, errors) {
  if (!targetWindow || typeof targetWindow !== "object") {
    errors.push("Plan is missing targetWindow.");
    return;
  }

  if (settings.organizeMode === ORGANIZE_MODES.CURRENT_WINDOW) {
    if (targetWindow.kind !== "current_window") {
      errors.push("Current-window mode targetWindow.kind must be current_window.");
    }
    if (Number.isInteger(scope.currentWindowId) && targetWindow.windowId !== scope.currentWindowId) {
      errors.push(`Current-window mode targetWindow.windowId must be ${scope.currentWindowId}.`);
    }
    return;
  }

  if (targetWindow.kind !== settings.targetWindowMode) {
    errors.push(`Plan targetWindow.kind ${targetWindow.kind || "<missing>"} does not match setting ${settings.targetWindowMode}.`);
  }
  if (settings.targetWindowMode === TARGET_WINDOW_MODES.SELECTED_WINDOW) {
    if (!Number.isInteger(settings.selectedTargetWindowId)) {
      errors.push("Selected-window mode requires a configured selectedTargetWindowId.");
    } else if (targetWindow.windowId !== settings.selectedTargetWindowId) {
      errors.push(`Selected-window mode targetWindow.windowId must be ${settings.selectedTargetWindowId}.`);
    }
  } else if (
    settings.targetWindowMode === TARGET_WINDOW_MODES.CURRENT_WINDOW &&
    Number.isInteger(scope.invocationWindowId) &&
    targetWindow.windowId !== scope.invocationWindowId
  ) {
    errors.push(`Current target-window mode targetWindow.windowId must be ${scope.invocationWindowId}.`);
  }
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
  if ((group.tabRefs || []).length > settings.maxTabsPerGroup) {
    errors.push(`Group ${group.title} has ${(group.tabRefs || []).length} tabs, above the limit ${settings.maxTabsPerGroup}.`);
  }
  if (Number(group.confidence) < settings.minConfidenceToApply) {
    errors.push(`Group ${group.title} confidence is below the apply threshold.`);
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

function collectGroupRefs(groups) {
  return groups.flatMap((group) => (Array.isArray(group?.tabRefs) ? group.tabRefs : []));
}
