import type { Expense } from './sync-types';

export type SpendingRank = { name: string; amount: number; count: number };
export type MerchantRank = SpendingRank & { items: SpendingRank[] };

function addToRank(groups: Map<string, SpendingRank>, name: string, amount: number) {
  const current = groups.get(name) || { name, amount: 0, count: 0 };
  current.amount += amount;
  current.count += 1;
  groups.set(name, current);
}

function sortedRanks(groups: Map<string, SpendingRank>) {
  return [...groups.values()].sort((a, b) => b.amount - a.amount || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
}

function sortedByFrequency(groups: Map<string, SpendingRank>) {
  return [...groups.values()].sort((a, b) => b.count - a.count || b.amount - a.amount || a.name.localeCompare(b.name, 'zh-CN'));
}

export function merchantName(expense: Expense) {
  return expense.merchant.trim().replace(/\s+/g, ' ') || '未填写商家或用途';
}

export function contentName(expense: Expense) {
  // Older imported bills stored their product description in note.
  return expense.itemName?.trim().replace(/\s+/g, ' ')
    || (expense.source === 'import' ? expense.note?.trim().replace(/\s+/g, ' ') : undefined)
    || '';
}

export function buildSpendingInsights(expenses: Expense[]) {
  const categories = new Map<string, SpendingRank>();
  const contents = new Map<string, SpendingRank>();
  const merchants = new Map<string, SpendingRank>();
  const merchantContents = new Map<string, Map<string, SpendingRank>>();

  expenses.forEach((expense) => {
    addToRank(categories, expense.category.trim() || '其他', expense.amount);
    const merchant = merchantName(expense);
    addToRank(merchants, merchant, expense.amount);
    const content = contentName(expense);
    if (content) {
      addToRank(contents, content, expense.amount);
      const byMerchant = merchantContents.get(merchant) || new Map<string, SpendingRank>();
      addToRank(byMerchant, content, expense.amount);
      merchantContents.set(merchant, byMerchant);
    }
  });

  return {
    total: expenses.reduce((sum, expense) => sum + expense.amount, 0),
    count: expenses.length,
    categories: sortedRanks(categories),
    contents: sortedByFrequency(contents),
    merchants: sortedRanks(merchants).map((merchant): MerchantRank => ({
      ...merchant,
      items: sortedByFrequency(merchantContents.get(merchant.name) || new Map()),
    })),
  };
}
