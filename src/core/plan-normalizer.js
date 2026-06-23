export function normalizePlanOrder(plan, inventory) {
  if (!plan || typeof plan !== "object") return plan;

  return {
    ...plan,
    groups: orderGroupsByOriginalPosition(
      (plan.groups || []).map((group) => ({ ...group, tabRefs: sortRefsByOriginalOrder(group.tabRefs || [], inventory) })),
      inventory
    ),
    reviewTabs: sortRefsByOriginalOrder(plan.reviewTabs || [], inventory)
  };
}

function sortRefsByOriginalOrder(refs, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return [...(refs || [])].sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
}

function orderGroupsByOriginalPosition(groups, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return [...(groups || [])].sort((left, right) => firstGroupOrder(left, tabOrder) - firstGroupOrder(right, tabOrder));
}

function firstGroupOrder(group, tabOrder) {
  const orders = (group.tabRefs || []).map((ref) => tabOrder(ref.tabId));
  return orders.length ? Math.min(...orders) : Number.MAX_SAFE_INTEGER;
}

function buildTabOrder(inventory) {
  const order = new Map();
  for (const [fallbackIndex, tab] of (inventory.plannerTabs || []).entries()) {
    const value = Number.isInteger(tab.sequenceIndex) ? tab.sequenceIndex : fallbackIndex;
    order.set(tab.tabId, value);
  }
  return (tabId) => order.get(tabId) ?? Number.MAX_SAFE_INTEGER;
}
