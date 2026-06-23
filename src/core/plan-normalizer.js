export function normalizePlanOrder(plan, inventory) {
  if (!plan || typeof plan !== "object") return plan;

  return {
    ...plan,
    groups: Array.isArray(plan.groups)
      ? orderGroupsByOriginalPosition(
          plan.groups.map((group) => ({
            ...group,
            tabRefs: Array.isArray(group?.tabRefs) ? sortRefsByOriginalOrder(group.tabRefs, inventory) : group?.tabRefs
          })),
          inventory
        )
      : plan.groups,
    reviewTabs: Array.isArray(plan.reviewTabs) ? sortRefsByOriginalOrder(plan.reviewTabs, inventory) : plan.reviewTabs
  };
}

function sortRefsByOriginalOrder(refs, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(refs).sort((left, right) => tabOrder(left.tabId) - tabOrder(right.tabId));
}

function orderGroupsByOriginalPosition(groups, inventory) {
  const tabOrder = buildTabOrder(inventory);
  return asArray(groups).sort((left, right) => firstGroupOrder(left, tabOrder) - firstGroupOrder(right, tabOrder));
}

function firstGroupOrder(group, tabOrder) {
  const orders = asArray(group?.tabRefs).map((ref) => tabOrder(ref.tabId));
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

function asArray(value) {
  return Array.isArray(value) ? [...value] : [];
}
