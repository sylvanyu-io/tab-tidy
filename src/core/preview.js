import { ORGANIZE_MODES, REVIEW_GROUP_MODES, normalizeSettings } from "../shared/settings.js";

export function buildPreview(plan, inventory, validation, rawSettings = {}) {
  const settings = normalizeSettings(rawSettings);
  const groupedTabIds = new Set((plan.groups || []).flatMap((group) => (group.tabRefs || []).map((ref) => ref.tabId)));
  const reviewTabIds = new Set((plan.reviewTabs || []).map((ref) => ref.tabId));
  const movedTabsCount =
    settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
      ? new Set([...(inventory.tabs || []).map((tab) => tab.tabId)]).size
      : 0;

  return {
    mode: settings.organizeMode,
    targetWindow: plan.targetWindow || null,
    requiresConfirmation: settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW,
    canApply: Boolean(validation?.ok),
    groupedTabsCount: groupedTabIds.size,
    reviewTabsCount: reviewTabIds.size,
    excludedTabsCount: (inventory.excludedTabs || []).length,
    lockedGroupsCount: (inventory.lockedGroups || []).length,
    movedTabsCount,
    reviewGroupWillBeCreated: settings.reviewGroupMode === REVIEW_GROUP_MODES.CREATE && reviewTabIds.size > 0,
    pageSampling: summarizePageSamples(inventory.pageSamples || []),
    groups: (plan.groups || []).map((group) => ({
      groupKey: group.groupKey,
      title: group.title,
      color: group.color,
      confidence: group.confidence,
      reason: group.reason,
      tabCount: (group.tabRefs || []).length
    })),
    warnings: [
      ...(validation?.warnings || []),
      ...((inventory.lockedGroups || []).length
        ? [`${inventory.lockedGroups.length} existing group(s) are locked by current settings.`]
        : []),
      ...(settings.organizeMode === ORGANIZE_MODES.CONSOLIDATE_ONE_WINDOW
        ? [`${movedTabsCount} eligible tab(s) will be moved into one target window.`]
        : [])
    ]
  };
}

function summarizePageSamples(results) {
  return {
    requested: results.length,
    ok: results.filter((result) => result.status === "ok").length,
    permissionRequired: results.filter((result) => result.status === "permission_required").length,
    blocked: results.filter((result) => ["blocked", "permission_denied", "unsupported_url", "missing"].includes(result.status)).length
  };
}
