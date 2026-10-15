import type { Expense } from './sync-types';

export type Period = 'today' | 'week' | 'month' | 'year';
export type TrendSelection = { start: string; end: string; label: string; source: 'week' | 'month' };

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function startOfWeek(date: Date) {
  const monday = new Date(date);
  const day = monday.getDay() || 7;
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - day + 1);
  return monday;
}

export function isInPeriod(value: string, period: Period, now = new Date()) {
  const date = new Date(value);
  if (period === 'today') return dateKey(date) === dateKey(now);
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  if (period === 'year') return date.getFullYear() === now.getFullYear();
  const monday = startOfWeek(now);
  const nextMonday = new Date(monday);
  nextMonday.setDate(nextMonday.getDate() + 7);
  return date >= monday && date < nextMonday;
}

export function fullDateLabel(date: Date) {
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekdays[date.getDay()]}`;
}

export function shortDayLabel(key: string) {
  const date = new Date(`${key}T12:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function trendSelectionFor(period: Period, now: Date, index: number): TrendSelection | null {
  if (!Number.isInteger(index) || index < 0) return null;
  if (period === 'week') {
    if (index > 6) return null;
    const date = startOfWeek(now);
    date.setDate(date.getDate() + index);
    return { start: dateKey(date), end: dateKey(date), label: fullDateLabel(date), source: 'week' };
  }
  if (period === 'month') {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const firstDay = index * 7 + 1;
    if (firstDay > lastDay) return null;
    const start = new Date(now.getFullYear(), now.getMonth(), firstDay, 12);
    const end = new Date(now.getFullYear(), now.getMonth(), Math.min(firstDay + 6, lastDay), 12);
    return { start: dateKey(start), end: dateKey(end), label: `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}–${end.getDate()}日`, source: 'month' };
  }
  return null;
}

export function buildTrend(expenses: Expense[], period: Period, now: Date) {
  if (period === 'today') {
    const result = Array.from({ length: 6 }, (_, index) => ({ key: `hour-${index}`, label: `${index * 4}–${(index + 1) * 4}时`, value: 0 }));
    expenses.filter((item) => isInPeriod(item.occurredAt, 'today', now)).forEach((item) => { result[Math.min(5, Math.floor(new Date(item.occurredAt).getHours() / 4))].value += item.amount; });
    return result;
  }
  if (period === 'week') {
    const monday = startOfWeek(now);
    const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const result = labels.map((label, index) => { const date = new Date(monday); date.setDate(date.getDate() + index); return { key: dateKey(date), label, value: 0 }; });
    const byKey = new Map(result.map((item) => [item.key, item]));
    expenses.filter((item) => isInPeriod(item.occurredAt, 'week', now)).forEach((item) => { const target = byKey.get(dateKey(new Date(item.occurredAt))); if (target) target.value += item.amount; });
    return result;
  }
  if (period === 'month') {
    const days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const result = Array.from({ length: Math.ceil(days / 7) }, (_, index) => ({ key: `week-${index}`, label: `${index * 7 + 1}–${Math.min(days, index * 7 + 7)}日`, value: 0 }));
    expenses.filter((item) => isInPeriod(item.occurredAt, 'month', now)).forEach((item) => { result[Math.floor((new Date(item.occurredAt).getDate() - 1) / 7)].value += item.amount; });
    return result;
  }
  const result = Array.from({ length: 12 }, (_, index) => ({ key: `month-${index}`, label: `${index + 1}月`, value: 0 }));
  expenses.filter((item) => isInPeriod(item.occurredAt, 'year', now)).forEach((item) => { result[new Date(item.occurredAt).getMonth()].value += item.amount; });
  return result;
}

export function buildHeatmap(expenses: Expense[], year: number) {
  const first = new Date(year, 0, 1);
  const last = new Date(year, 11, 31);
  const startPadding = (first.getDay() + 6) % 7;
  const totals = new Map<string, { amount: number; count: number }>();
  expenses.filter((item) => new Date(item.occurredAt).getFullYear() === year).forEach((item) => {
    const key = dateKey(new Date(item.occurredAt));
    const current = totals.get(key) || { amount: 0, count: 0 };
    totals.set(key, { amount: current.amount + item.amount, count: current.count + 1 });
  });
  const nonzero = [...totals.values()].map((item) => item.amount).filter(Boolean).sort((a, b) => a - b);
  const levelFor = (amount: number) => {
    if (!amount || !nonzero.length) return 0;
    const rank = nonzero.filter((value) => value <= amount).length;
    return Math.max(1, Math.min(4, Math.ceil(rank / nonzero.length * 4)));
  };
  const days: Array<{ key: string; date: Date; amount: number; count: number; level: number } | null> = Array.from({ length: startPadding }, () => null);
  for (const cursor = new Date(first); cursor <= last; cursor.setDate(cursor.getDate() + 1)) {
    const date = new Date(cursor);
    const key = dateKey(date);
    const total = totals.get(key) || { amount: 0, count: 0 };
    days.push({ key, date, ...total, level: levelFor(total.amount) });
  }
  const months = Array.from({ length: 12 }, (_, month) => {
    const dayOffset = Math.round((Date.UTC(year, month, 1) - Date.UTC(year, 0, 1)) / 86_400_000);
    return { label: `${month + 1}月`, week: Math.floor((startPadding + dayOffset) / 7) };
  });
  return { year, days, months, startPadding };
}
