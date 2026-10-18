'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Channel, Expense, PaymentChoice, SyncChange, SyncOperation, SyncResponse } from '@/lib/sync-types';
import { buildHeatmap, buildTrend, dateKey, fullDateLabel, isInPeriod, shortDayLabel, trendSelectionFor, type Period, type TrendSelection } from '@/lib/period-analytics';
import { buildSpendingInsights, contentName, merchantName } from '@/lib/spending-insights';

type SyncStatus = 'connecting' | 'saving' | 'synced' | 'offline' | 'error';
type Draft = Omit<Expense, 'id' | 'amount' | 'source' | 'demo'> & { amount: string };
type SyncOperationInput =
  | { kind: 'upsert'; expense: Expense }
  | { kind: 'delete'; expenseId: string }
  | { kind: 'settings'; settings: { budget: number; lastPayment: PaymentChoice } };
type ImportPreview = {
  filename: string;
  channel: Channel;
  expenses: Expense[];
  ignored: number;
  encoding: string;
};
type InsightScope = 'all' | 'year' | 'month' | 'week';

const STORAGE_KEY = 'spending-trace-expenses-v1';
const SETTINGS_KEY = 'spending-trace-settings-v1';
const OUTBOX_KEY = 'spending-trace-sync-outbox-v1';
const REVISION_KEY = 'spending-trace-sync-revision-v1';
const DEVICE_KEY = 'spending-trace-device-v1';
const categories = ['餐饮', '小甜水', '交通', '购物', '衣裤', '日用', '娱乐', '游戏', '学习资料', 'AI订阅', '医疗', '住房', '人情', '其他'];
const channels: Channel[] = ['微信', '支付宝', '校园卡', '银行卡'];
const methods = ['零钱', '花呗', '银行卡', '余额', '直接支付', '其他'];
const paymentPresets: Array<PaymentChoice & { label: string; detail: string; image: string }> = [
  { channel: '微信', method: '零钱', label: '微信零钱', detail: '微信余额', image: '/payment-cards/wechat-balance.jpg' },
  { channel: '微信', method: '银行卡', label: '微信银行卡', detail: '微信绑卡', image: '/payment-cards/wechat-bank.jpg' },
  { channel: '支付宝', method: '花呗', label: '支付宝花呗', detail: '花呗付款', image: '/payment-cards/alipay-huabei.jpg' },
  { channel: '支付宝', method: '银行卡', label: '支付宝银行卡', detail: '支付宝绑卡', image: '/payment-cards/alipay-bank.jpg' },
  { channel: '校园卡', method: '余额', label: '校园卡余额', detail: '校园卡账户', image: '/payment-cards/campus-balance.jpg' },
  { channel: '银行卡', method: '直接支付', label: '银行卡支付', detail: '银行卡直接付款', image: '/payment-cards/bank-direct.jpg' },
];
const channelStyles: Array<{ channel: Channel; className: string }> = [
  { channel: '微信', className: 'wechat' },
  { channel: '支付宝', className: 'alipay' },
  { channel: '校园卡', className: 'campus' },
  { channel: '银行卡', className: 'bank' },
];

function paymentIconFor(item: Expense) {
  const method = item.method || '';
  if (item.channel === '微信') {
    if (/银行卡|银行|储蓄卡|信用卡|借记卡/.test(method)) return '/payment-icons/wechat-bank.jpg';
    if (/零钱|余额|零钱通/.test(method)) return '/payment-icons/wechat-balance.jpg';
  }
  if (item.channel === '支付宝') {
    if (/花呗/.test(method)) return '/payment-icons/alipay-huabei.jpg';
    if (/银行卡|银行|储蓄卡|信用卡|借记卡/.test(method)) return '/payment-icons/alipay-bank.jpg';
  }
  if (item.channel === '校园卡') return '/payment-icons/soochow-campus-burgundy.jpg';
  if (item.channel === '银行卡') return '/payment-icons/bank-direct.jpg';
  return null;
}

function PaymentLogo({ item }: { item: Expense }) {
  const kind = channelStyles.find((style) => style.channel === item.channel)?.className || 'bank';
  const icon = paymentIconFor(item);
  return <span className={`payment-logo ${kind}${icon ? ' is-generated' : ''}`} style={icon ? { backgroundImage: `url(${icon})` } : undefined} aria-hidden="true">
    {!icon && item.channel === '微信' && <svg viewBox="0 0 40 40" focusable="false"><path fill="currentColor" fillRule="evenodd" d="M17.4 8C10.5 8 5 12.6 5 18.2c0 2.5 1.1 4.7 3 6.5l-1 4.4 4.8-2.4c1.7.7 3.6 1.1 5.6 1.1h1c-1.1-1.7-1.7-3.5-1.7-5.4 0-5.2 4.7-9.3 10.9-9.7C25.3 9.8 21.6 8 17.4 8Zm-5.1 9.1a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Zm9.2 0a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2Z"/><path fill="currentColor" fillRule="evenodd" d="M28.4 15c-5.8 0-10.6 3.7-10.6 8.3s4.8 8.3 10.6 8.3c1.5 0 2.9-.2 4.2-.7l3.6 1.8-.8-3.3a7.7 7.7 0 0 0 3.6-6.1c0-4.6-4.7-8.3-10.6-8.3Zm-3.7 7.4a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Zm7.3 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6Z"/></svg>}
    {!icon && item.channel === '支付宝' && <svg viewBox="0 0 40 40" focusable="false"><text x="20" y="28" textAnchor="middle" fill="currentColor" fontFamily="-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif" fontWeight="800" fontSize="28">支</text></svg>}
    {!icon && item.channel === '校园卡' && <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" focusable="false"><path d="m7 16 13-7 13 7M9 18h22M11 30h18M8 33h24M13 19v11m7-11v11m7-11v11"/></svg>}
    {!icon && item.channel === '银行卡' && <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" focusable="false"><rect x="6" y="10" width="28" height="20" rx="3.5"/><path d="M7 17h26M11 25h6"/></svg>}
  </span>;
}

function isChannel(value: unknown): value is Channel {
  return channels.includes(value as Channel);
}

function localDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function makeDraft(payment: PaymentChoice = { channel: '微信', method: '零钱' }): Draft {
  return { amount: '', merchant: '', itemName: '', category: '餐饮', channel: payment.channel, method: payment.method, occurredAt: localDateTime(), note: '' };
}

function demoData(): Expense[] {
  const at = (hoursAgo: number) => localDateTime(new Date(Date.now() - hoursAgo * 3_600_000));
  return [
    { id: 'demo-1', amount: 42, merchant: '午餐', category: '餐饮', channel: '支付宝', method: '花呗', occurredAt: at(3), source: 'manual', demo: true },
    { id: 'demo-2', amount: 31.2, merchant: '网约车', category: '交通', channel: '微信', method: '银行卡', occurredAt: at(6), source: 'manual', demo: true },
    { id: 'demo-3', amount: 15, merchant: '咖啡', category: '餐饮', channel: '支付宝', method: '银行卡', occurredAt: at(9), source: 'manual', demo: true },
    { id: 'demo-4', amount: 38.6, merchant: '社区便利店', category: '日用', channel: '微信', method: '零钱', occurredAt: at(25), source: 'manual', demo: true },
    { id: 'demo-5', amount: 128, merchant: '生活用品', category: '购物', channel: '支付宝', method: '花呗', occurredAt: at(51), source: 'manual', demo: true },
  ];
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(value);
}

function csvEscape(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseCsvLine(line: string, delimiter = ',') {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function pick(row: Record<string, string>, names: string[]) {
  for (const name of names) if (row[name]) return row[name];
  return '';
}

function autoCategory(text: string) {
  const rules: Array<[string, RegExp]> = [
    ['小甜水', /奶茶|果茶|饮品|咖啡|拿铁|可乐|果汁|甜水|瑞幸|星巴克/],
    ['衣裤', /衣服|裤子|服饰|女装|男装|鞋帽|鞋子|外套|裙子/],
    ['游戏', /游戏|Steam|米哈游|腾讯游戏|网易游戏|PlayStation|Nintendo/i],
    ['学习资料', /教材|教辅|课本|学习资料|网课|课程|书籍|图书/],
    ['餐饮', /餐|饭|面|粉|粥|茶|奶|饮|食|肯德基|麦当劳|美团|饿了么|便利店/],
    ['交通', /地铁|公交|铁路|高铁|火车|机票|航空|滴滴|打车|网约车|出租|加油|停车|高速|单车/],
    ['购物', /淘宝|天猫|京东|拼多多|唯品会|商城|商场|超市|数码|家电/],
    ['日用', /药店|生活用品|日用品|百货|洗护|纸巾|家居/],
    ['AI订阅', /ChatGPT|OpenAI|Claude|Gemini|DeepSeek|Cursor|Copilot|Midjourney|AI订阅|人工智能订阅/i],
    ['娱乐', /电影|影院|视频|音乐|会员|演出|KTV|健身/],
    ['住房', /房租|物业|水费|电费|燃气|宽带|话费/],
    ['医疗', /医院|诊所|医疗|挂号|体检|药房/],
    ['人情', /红包|转账|礼物|礼金/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || '其他';
}

function parseExpenseCsv(text: string, filename: string) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /交易时间|交易创建时间|创建时间|付款时间|时间/.test(line) && /金额/.test(line));
  if (headerIndex < 0) throw new Error('没有找到包含“交易时间”和“金额”的表头');
  const delimiter = (lines[headerIndex].match(/\t/g)?.length || 0) > (lines[headerIndex].match(/,/g)?.length || 0) ? '\t' : ',';
  const headers = parseCsvLine(lines[headerIndex], delimiter).map((cell) => cell.replace(/[\s\uFEFF]/g, ''));
  const inferredChannel: Channel = /支付宝|alipay/i.test(filename + text.slice(0, 300)) ? '支付宝' : '微信';
  let ignored = 0;
  const expenses = lines.slice(headerIndex + 1).map((line, index): Expense | null => {
    const cells = parseCsvLine(line, delimiter);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || '']));
    const direction = pick(row, ['收/支', '收支', '收支类型', '交易类型']);
    const status = pick(row, ['交易状态', '当前状态']);
    if (/收入|退款|已退款|交易关闭|已关闭|失败|待付款/.test(direction + status)) { ignored += 1; return null; }
    const amount = Number(pick(row, ['金额(元)', '金额（元）', '订单金额(元)', '订单金额（元）', '实付金额', '金额', '交易金额']).replace(/[¥￥,\s]/g, ''));
    const rawTime = pick(row, ['交易时间', '交易创建时间', '创建时间', '付款时间', '时间']).replaceAll('/', '-');
    if (!Number.isFinite(amount) || amount <= 0 || !rawTime) { ignored += 1; return null; }
    const occurredAt = rawTime.length >= 16 ? rawTime.slice(0, 16).replace(' ', 'T') : localDateTime();
    const merchant = pick(row, ['交易对方', '交易对象', '商户名称', '卖家信息', '名称', '商家', '商品名称', '商品', '商品说明', '交易说明']) || '账单导入';
    const product = pick(row, ['消费内容', '商品名称', '商品', '商品说明', '交易说明']);
    const method = pick(row, ['支付方式', '支付渠道', '付款方式']) || inferredChannel;
    const rowChannel = pick(row, ['渠道']);
    const channel: Channel = rowChannel === '支付宝' || rowChannel === '微信' ? rowChannel : inferredChannel;
    const externalId = pick(row, ['交易单号', '交易号', '支付宝交易号', '订单号', '商户订单号']);
    return {
      id: `import-${Date.now()}-${index}`,
      amount,
      merchant,
      itemName: product && product !== merchant ? product : undefined,
      category: pick(row, ['分类']) || autoCategory(`${merchant} ${product}`),
      channel,
      method,
      occurredAt,
      note: pick(row, ['备注']) || (product && product !== merchant ? product : ''),
      externalId: externalId || undefined,
      source: 'import' as const,
    };
  }).filter((item): item is Expense => item !== null);
  if (!expenses.length) throw new Error('没有识别到有效支出；请确认选择的是解压后的消费明细 CSV');
  return { expenses, channel: inferredChannel, ignored };
}

function signature(item: Expense) {
  if (item.externalId) return `${item.channel}|id:${item.externalId}`;
  return `${item.channel}|${item.occurredAt.slice(0, 16)}|${item.amount.toFixed(2)}|${item.merchant.replaceAll(' ', '')}`;
}

function isLikelyManualDuplicate(a: Expense, b: Expense) {
  if (a.channel !== b.channel || Math.abs(a.amount - b.amount) > 0.005) return false;
  return Math.abs(new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()) <= 15 * 60_000;
}

function mergeExpenses(cloud: Expense[], local: Expense[]) {
  const merged = [...cloud];
  const ids = new Set(cloud.map((item) => item.id));
  const signatures = new Set(cloud.map(signature));
  local.filter((item) => !item.demo).forEach((item) => {
    const key = signature(item);
    if (!ids.has(item.id) && !signatures.has(key)) {
      merged.push(item);
      ids.add(item.id);
      signatures.add(key);
    }
  });
  return merged;
}

function readOutbox() {
  try {
    const value = JSON.parse(window.localStorage.getItem(OUTBOX_KEY) || '[]');
    return Array.isArray(value) ? value as SyncOperation[] : [];
  } catch { return []; }
}

function writeOutbox(operations: SyncOperation[]) {
  window.localStorage.setItem(OUTBOX_KEY, JSON.stringify(operations));
}

function deviceId() {
  const saved = window.localStorage.getItem(DEVICE_KEY);
  if (saved) return saved;
  const created = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_KEY, created);
  return created;
}

function operation(value: SyncOperationInput): SyncOperation {
  return { ...value, operationId: crypto.randomUUID(), deviceId: deviceId(), queuedAt: new Date().toISOString() };
}

function coalesceOutbox(current: SyncOperation[], additions: SyncOperation[]) {
  const next = [...current];
  additions.forEach((addition) => {
    if (addition.kind === 'settings') {
      for (let index = next.length - 1; index >= 0; index -= 1) if (next[index].kind === 'settings') next.splice(index, 1);
    } else {
      const expenseId = addition.kind === 'upsert' ? addition.expense.id : addition.expenseId;
      for (let index = next.length - 1; index >= 0; index -= 1) {
        const item = next[index];
        if (item.kind !== 'settings' && (item.kind === 'upsert' ? item.expense.id : item.expenseId) === expenseId) next.splice(index, 1);
      }
    }
    next.push(addition);
  });
  return next;
}

function applyChanges(expenses: Expense[], changes: SyncChange[]) {
  const byId = new Map(expenses.filter((item) => !item.demo).map((item) => [item.id, item]));
  changes.forEach((change) => {
    if (change.kind === 'delete') byId.delete(change.expenseId);
    else byId.set(change.expense.id, change.expense);
  });
  return [...byId.values()];
}

function applyPending(expenses: Expense[], pending: SyncOperation[]) {
  const byId = new Map(expenses.map((item) => [item.id, item]));
  pending.forEach((item) => {
    if (item.kind === 'delete') byId.delete(item.expenseId);
    else if (item.kind === 'upsert') byId.set(item.expense.id, item.expense);
  });
  return [...byId.values()];
}

async function decodeCsv(file: File) {
  const buffer = await file.arrayBuffer();
  const candidates: Array<[string, string]> = [['UTF-8', new TextDecoder('utf-8').decode(buffer)]];
  try { candidates.push(['GB18030', new TextDecoder('gb18030').decode(buffer)]); } catch { /* UTF-8 remains available */ }
  return candidates.find(([, text]) => /交易时间|交易创建时间|创建时间|付款时间/.test(text) && /金额/.test(text)) || candidates[0];
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [period, setPeriod] = useState<Period>('month');
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [trendSelection, setTrendSelection] = useState<TrendSelection | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [insightScope, setInsightScope] = useState<InsightScope>('all');
  const [selectedMerchant, setSelectedMerchant] = useState<string | null>(null);
  const [showAllMerchants, setShowAllMerchants] = useState(false);
  const [now, setNow] = useState<Date | null>(null);
  const [selectedHeatmapKey, setSelectedHeatmapKey] = useState('');
  const [budget, setBudget] = useState(5000);
  const [lastPayment, setLastPayment] = useState<PaymentChoice>({ channel: '微信', method: '零钱' });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [pendingCount, setPendingCount] = useState(0);
  const [ready, setReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showData, setShowData] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(makeDraft());
  const [notice, setNotice] = useState('');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const expensesRef = useRef<Expense[]>([]);
  const budgetRef = useRef(5000);
  const paymentRef = useRef<PaymentChoice>({ channel: '微信', method: '零钱' });
  const revisionRef = useRef(0);
  const syncInFlight = useRef(false);
  const cloudHydrated = useRef(false);
  const syncRunner = useRef<() => Promise<void>>(async () => undefined);
  const heatmapScroller = useRef<HTMLDivElement>(null);
  const transactionsPanel = useRef<HTMLElement>(null);
  const merchantDetailPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        const settings = window.localStorage.getItem(SETTINGS_KEY);
        setExpenses(saved ? JSON.parse(saved) : demoData());
        revisionRef.current = Number(window.localStorage.getItem(REVISION_KEY)) || 0;
        setPendingCount(readOutbox().length);
        deviceId();
        const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
        setIsStandalone(window.matchMedia('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true);
        setIsIos(/iphone|ipad|ipod/i.test(navigator.userAgent));
        let savedPayment: PaymentChoice = { channel: '微信', method: '零钱' };
        if (settings) {
          const parsed = JSON.parse(settings);
          setBudget(Number(parsed.budget) || 5000);
          if (isChannel(parsed.lastChannel) && typeof parsed.lastMethod === 'string') {
            savedPayment = { channel: parsed.lastChannel, method: parsed.lastMethod };
            setLastPayment(savedPayment);
          }
        }
        const params = new URLSearchParams(window.location.search);
        const amount = params.get('amount');
        if (amount) {
          const requestedChannel = params.get('channel');
          const channel = isChannel(requestedChannel) ? requestedChannel : savedPayment.channel;
          const method = params.get('method') || savedPayment.method;
          setDraft({ ...makeDraft({ channel, method }), amount, merchant: params.get('merchant') || '' });
          setShowAdd(true);
          window.history.replaceState({}, '', window.location.pathname);
        }
      } catch { setExpenses(demoData()); }
      setReady(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses)); }, [expenses, ready]);
  useEffect(() => {
    if (ready) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ budget, lastChannel: lastPayment.channel, lastMethod: lastPayment.method }));
  }, [budget, lastPayment, ready]);
  useEffect(() => { expensesRef.current = expenses; }, [expenses]);
  useEffect(() => { budgetRef.current = budget; }, [budget]);
  useEffect(() => { paymentRef.current = lastPayment; }, [lastPayment]);
  useEffect(() => {
    const refreshDate = () => {
      const next = new Date();
      setNow(next);
      setSelectedHeatmapKey((current) => current || dateKey(next));
    };
    refreshDate();
    const interval = window.setInterval(refreshDate, 60_000);
    window.addEventListener('focus', refreshDate);
    document.addEventListener('visibilitychange', refreshDate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshDate);
      document.removeEventListener('visibilitychange', refreshDate);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let active = true;

    function acceptSyncResult(result: SyncResponse, initial = false) {
      const accepted = new Set(result.acceptedOperationIds || []);
      let pending = readOutbox().filter((item) => !accepted.has(item.operationId));

      if (initial) {
        const cloudExpenses = result.state?.expenses || applyChanges([], result.changes);
        const cloudIds = new Set(cloudExpenses.map((item) => item.id));
        const cloudSignatures = new Set(cloudExpenses.map(signature));
        const deletedIds = new Set(result.changes.filter((item) => item.kind === 'delete').map((item) => item.kind === 'delete' ? item.expenseId : ''));
        const localUnique = expensesRef.current.filter((item) => !item.demo && !deletedIds.has(item.id) && !cloudIds.has(item.id) && !cloudSignatures.has(signature(item)));
        const migrationOperations = localUnique.map((expense) => operation({ kind: 'upsert', expense }));
        if (result.revision === 0) migrationOperations.push(operation({ kind: 'settings', settings: { budget: budgetRef.current, lastPayment: paymentRef.current } }));
        if (migrationOperations.length) pending = coalesceOutbox(pending, migrationOperations);
        const merged = mergeExpenses(cloudExpenses, expensesRef.current.filter((item) => !deletedIds.has(item.id)));
        const next = applyPending(merged, pending);
        expensesRef.current = next;
        setExpenses(next);
      } else {
        setExpenses((current) => {
          const next = applyPending(applyChanges(current, result.changes), pending);
          expensesRef.current = next;
          return next;
        });
      }

      writeOutbox(pending);
      const pendingSettings = [...pending].reverse().find((item) => item.kind === 'settings');
      if (pendingSettings?.kind === 'settings') {
        budgetRef.current = pendingSettings.settings.budget;
        paymentRef.current = pendingSettings.settings.lastPayment;
        setBudget(pendingSettings.settings.budget);
        setLastPayment(pendingSettings.settings.lastPayment);
      } else {
        budgetRef.current = result.settings.budget;
        paymentRef.current = result.settings.lastPayment;
        setBudget(result.settings.budget);
        setLastPayment(result.settings.lastPayment);
      }
      revisionRef.current = result.revision;
      window.localStorage.setItem(REVISION_KEY, String(result.revision));
      setPendingCount(pending.length);
    }

    async function runSync() {
      if (syncInFlight.current) {
        window.setTimeout(() => syncRunner.current(), 300);
        return;
      }
      syncInFlight.current = true;
      let pulled = false;
      try {
        if (!cloudHydrated.current) {
          setSyncStatus('connecting');
          const response = await fetch('/api/sync?since=0', { cache: 'no-store' });
          if (!response.ok) throw new Error('cloud unavailable');
          acceptSyncResult(await response.json() as SyncResponse, true);
          cloudHydrated.current = true;
          pulled = true;
        }

        let rounds = 0;
        while (active && readOutbox().length && rounds < 20) {
          rounds += 1;
          setSyncStatus('saving');
          const pending = readOutbox();
          const response = await fetch('/api/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ since: revisionRef.current, operations: pending.slice(0, 100) }),
          });
          if (!response.ok) throw new Error('cloud save failed');
          acceptSyncResult(await response.json() as SyncResponse);
          pulled = true;
        }

        if (!pulled) {
          const response = await fetch(`/api/sync?since=${revisionRef.current}`, { cache: 'no-store' });
          if (!response.ok) throw new Error('cloud unavailable');
          acceptSyncResult(await response.json() as SyncResponse);
        }
        if (!active) return;
        const remaining = readOutbox().length;
        setPendingCount(remaining);
        setSyncStatus(remaining ? 'saving' : 'synced');
        if (remaining) window.setTimeout(() => syncRunner.current(), 400);
      } catch {
        if (!active) return;
        const remaining = readOutbox().length;
        setPendingCount(remaining);
        setSyncStatus(navigator.onLine ? 'error' : 'offline');
      } finally { syncInFlight.current = false; }
    }

    syncRunner.current = runSync;
    runSync();
    const interval = window.setInterval(runSync, 15_000);
    const onOnline = () => runSync();
    const onOffline = () => setSyncStatus('offline');
    const onFocus = () => runSync();
    const onVisibility = () => { if (document.visibilityState === 'visible') runSync(); };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ready]);

  function queueOperations(additions: SyncOperation[]) {
    const next = coalesceOutbox(readOutbox(), additions);
    writeOutbox(next);
    setPendingCount(next.length);
    setSyncStatus(navigator.onLine ? 'saving' : 'offline');
    if (navigator.onLine) window.setTimeout(() => syncRunner.current(), 0);
  }

  function queueSettings(nextBudget: number, nextPayment: PaymentChoice) {
    queueOperations([operation({ kind: 'settings', settings: { budget: nextBudget, lastPayment: nextPayment } })]);
  }

  const calculationDate = useMemo(() => now || new Date(2000, 0, 1, 12), [now]);
  const periodDate = useMemo(() => selectedMonth === null
    ? calculationDate
    : new Date(calculationDate.getFullYear(), selectedMonth, 1, 12), [calculationDate, selectedMonth]);
  const visible = useMemo(() => expenses.filter((item) => isInPeriod(item.occurredAt, period, periodDate)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [expenses, period, periodDate]);
  const transactionExpenses = useMemo(() => trendSelection && trendSelection.source === period
    ? visible.filter((item) => item.occurredAt.slice(0, 10) >= trendSelection.start && item.occurredAt.slice(0, 10) <= trendSelection.end)
    : visible, [visible, period, trendSelection]);
  const selectionTotal = useMemo(() => transactionExpenses.reduce((sum, item) => sum + item.amount, 0), [transactionExpenses]);
  const total = useMemo(() => visible.reduce((sum, item) => sum + item.amount, 0), [visible]);
  const monthTotal = useMemo(() => expenses.filter((item) => isInPeriod(item.occurredAt, 'month', periodDate)).reduce((sum, item) => sum + item.amount, 0), [expenses, periodDate]);

  const categoryTotals = useMemo(() => {
    const values = new Map<string, number>();
    visible.forEach((item) => values.set(item.category, (values.get(item.category) || 0) + item.amount));
    return [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [visible]);

  const channelTotals = useMemo(() => channelStyles.map((style) => ({
    ...style,
    amount: visible.filter((item) => item.channel === style.channel).reduce((sum, item) => sum + item.amount, 0),
  })), [visible]);

  const trend = useMemo(() => buildTrend(expenses, period, periodDate), [expenses, period, periodDate]);
  const currentYear = calculationDate.getFullYear();
  const heatmap = useMemo(() => buildHeatmap(expenses, currentYear), [expenses, currentYear]);
  const currentYearDayOffset = Math.round((Date.UTC(currentYear, calculationDate.getMonth(), calculationDate.getDate()) - Date.UTC(currentYear, 0, 1)) / 86_400_000);
  const currentHeatmapWeek = Math.floor((heatmap.startPadding + currentYearDayOffset) / 7);
  const selectedHeatmapDay = heatmap.days.find((item) => item?.key === selectedHeatmapKey) || heatmap.days.find((item) => item?.key === dateKey(calculationDate)) || null;
  const insightExpenses = useMemo(() => expenses.filter((item) => insightScope === 'all' || isInPeriod(item.occurredAt, insightScope, calculationDate)), [expenses, insightScope, calculationDate]);
  const insights = useMemo(() => buildSpendingInsights(insightExpenses), [insightExpenses]);
  const merchantDetail = insights.merchants.find((item) => item.name === selectedMerchant);
  const merchantExpenses = useMemo(() => selectedMerchant
    ? insightExpenses.filter((item) => merchantName(item) === selectedMerchant).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    : [], [insightExpenses, selectedMerchant]);

  const summaryCards = useMemo(() => {
    const monthLabel = selectedMonth === null ? '本月' : `${periodDate.getMonth() + 1}月`;
    const primary = { label: `${period === 'today' ? '今日' : period === 'week' ? '本周' : period === 'month' ? monthLabel : '本年'}支出`, value: money(total), detail: `${visible.length} 笔消费` };
    if (period === 'today') {
      return [primary, { label: '消费笔数', value: String(visible.length), detail: '笔消费' }, { label: '平均每笔', value: money(visible.length ? total / visible.length : 0), detail: '今日单笔均值' }];
    }
    if (period === 'month') {
      const remaining = budget - monthTotal;
      const elapsedDays = selectedMonth === null ? calculationDate.getDate() : new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0).getDate();
      return [primary, { label: '日均支出', value: money(total / elapsedDays), detail: selectedMonth === null ? `截至今日 ${elapsedDays} 天` : `全月 ${elapsedDays} 天` }, { label: remaining >= 0 ? '月预算剩余' : '已超出预算', value: money(Math.abs(remaining)), detail: `预算 ${money(budget)}` }];
    }
    if (period === 'year') {
      const monthly = Array.from({ length: 12 }, () => 0);
      visible.forEach((item) => { monthly[new Date(item.occurredAt).getMonth()] += item.amount; });
      const highest = Math.max(...monthly);
      const highestMonth = highest ? monthly.indexOf(highest) : -1;
      return [primary, { label: '月均支出', value: money(total / (calculationDate.getMonth() + 1)), detail: `截至${calculationDate.getMonth() + 1}月` }, { label: '最高消费月', value: money(highest), detail: highestMonth >= 0 ? `${highestMonth + 1}月` : '暂无消费' }];
    }
    const daily = new Map<string, number>();
    visible.forEach((item) => { const key = dateKey(new Date(item.occurredAt)); daily.set(key, (daily.get(key) || 0) + item.amount); });
    const highest = [...daily.entries()].sort((a, b) => b[1] - a[1])[0];
    const elapsed = calculationDate.getDay() || 7;
    return [primary, { label: '日均支出', value: money(total / elapsed), detail: `本周已过 ${elapsed} 天` }, { label: '最高消费日', value: money(highest?.[1] || 0), detail: highest ? shortDayLabel(highest[0]) : '暂无消费' }];
  }, [period, total, visible, budget, monthTotal, calculationDate, periodDate, selectedMonth]);

  useEffect(() => {
    const scroller = heatmapScroller.current;
    if (!scroller) return;
    scroller.scrollLeft = Math.max(0, currentHeatmapWeek * 13 - scroller.clientWidth * 0.7);
  }, [currentHeatmapWeek]);

  const latestImport = useMemo(() => {
    const imported = expenses.filter((item) => item.batchId && item.importedAt).sort((a, b) => (b.importedAt || '').localeCompare(a.importedAt || ''));
    if (!imported.length) return null;
    const batchId = imported[0].batchId;
    const rows = imported.filter((item) => item.batchId === batchId);
    return { batchId, filename: rows[0].sourceFile || '官方账单', importedAt: rows[0].importedAt || '', count: rows.length };
  }, [expenses]);

  function openNew() { setEditingId(null); setDraft(makeDraft(lastPayment)); setShowAdd(true); }
  function openEdit(item: Expense) { setEditingId(item.id); setDraft({ amount: String(item.amount), merchant: item.merchant, itemName: item.itemName || '', category: item.category, channel: item.channel, method: item.method, occurredAt: item.occurredAt, note: item.note || '' }); setShowAdd(true); }

  function choosePayment(payment: PaymentChoice) {
    setDraft((current) => ({ ...current, channel: payment.channel, method: payment.method }));
  }

  function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setNotice('请输入正确的消费金额'); return; }
    let savedExpense: Expense;
    if (editingId) {
      const original = expensesRef.current.find((item) => item.id === editingId);
      savedExpense = { ...original, ...draft, id: editingId, amount, source: original?.source || 'manual', demo: false };
      setExpenses((current) => current.map((item) => item.id === editingId ? savedExpense : item));
      setNotice('记录已更新');
    } else {
      savedExpense = { ...draft, id: crypto.randomUUID(), amount, source: 'manual' };
      setExpenses((current) => [savedExpense, ...current]);
      setNotice(navigator.onLine ? '已保存，正在同步' : '已离线保存，联网后自动同步');
    }
    const nextPayment = { channel: draft.channel, method: draft.method };
    expensesRef.current = editingId ? expensesRef.current.map((item) => item.id === editingId ? savedExpense : item) : [savedExpense, ...expensesRef.current];
    paymentRef.current = nextPayment;
    setLastPayment(nextPayment);
    queueOperations([
      operation({ kind: 'upsert', expense: savedExpense }),
      operation({ kind: 'settings', settings: { budget: budgetRef.current, lastPayment: nextPayment } }),
    ]);
    setShowAdd(false);
    setTimeout(() => setNotice(''), 2200);
  }

  function removeExpense() {
    if (!editingId || !window.confirm('确定删除这条消费记录吗？')) return;
    setExpenses((current) => current.filter((item) => item.id !== editingId));
    expensesRef.current = expensesRef.current.filter((item) => item.id !== editingId);
    queueOperations([operation({ kind: 'delete', expenseId: editingId })]);
    setShowAdd(false);
    setNotice(navigator.onLine ? '记录已删除，正在同步' : '已离线删除，联网后自动同步');
    setTimeout(() => setNotice(''), 2200);
  }

  function download(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportJson() {
    download(`消费有迹备份-${dateKey(new Date())}.json`, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), budget, expenses }, null, 2), 'application/json');
  }

  function exportCsv() {
    const header = ['时间', '金额', '商家', '消费内容', '分类', '渠道', '付款方式', '备注'];
    const rows = expenses.map((item) => [item.occurredAt.replace('T', ' '), item.amount, item.merchant, item.itemName || '', item.category, item.channel, item.method, item.note || ''].map(csvEscape).join(','));
    download(`消费记录-${dateKey(new Date())}.csv`, `\uFEFF${header.map(csvEscape).join(',')}\n${rows.join('\n')}`, 'text/csv;charset=utf-8');
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const extension = file.name.toLowerCase().split('.').pop();
      if (extension === 'zip' || extension === 'xls' || extension === 'xlsx') throw new Error('请先在“文件”App 中解压，并选择其中的 CSV 明细文件');
      if (extension === 'json') {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const incoming: Expense[] = Array.isArray(parsed) ? parsed : parsed.expenses;
        if (!Array.isArray(incoming)) throw new Error('备份中没有消费记录');
        if (parsed.budget) {
          const nextBudget = Number(parsed.budget);
          budgetRef.current = nextBudget;
          setBudget(nextBudget);
          queueSettings(nextBudget, paymentRef.current);
        }
        const known = new Set(expenses.map(signature));
        const unique = incoming.filter((item) => !known.has(signature(item)));
        setExpenses((current) => [...unique, ...current]);
        expensesRef.current = [...unique, ...expensesRef.current];
        queueOperations(unique.map((expense) => operation({ kind: 'upsert', expense })));
        setNotice(`备份已恢复：新增 ${unique.length} 笔记录`);
        setShowData(false);
      } else {
        const [encoding, text] = await decodeCsv(file);
        const parsed = parseExpenseCsv(text, file.name);
        setImportPreview({ filename: file.name, expenses: parsed.expenses, channel: parsed.channel, ignored: parsed.ignored, encoding });
        setShowData(false);
      }
    } catch (error) { setNotice(`导入失败：${error instanceof Error ? error.message : '文件格式不正确'}`); }
    event.target.value = '';
    setTimeout(() => setNotice(''), 3800);
  }

  function confirmBillImport() {
    if (!importPreview) return;
    const importedAt = new Date().toISOString();
    const batchId = `batch-${Date.now()}`;
    const known = new Set(expenses.map(signature));
    let duplicates = 0;
    const additions = importPreview.expenses.map((item) => ({
      ...item,
      channel: importPreview.channel,
      batchId,
      importedAt,
      sourceFile: importPreview.filename,
    })).filter((item) => {
      if (known.has(signature(item)) || expenses.some((current) => isLikelyManualDuplicate(current, item))) { duplicates += 1; return false; }
      known.add(signature(item));
      return true;
    });
    setExpenses((current) => [...additions, ...current]);
    expensesRef.current = [...additions, ...expensesRef.current];
    queueOperations(additions.map((expense) => operation({ kind: 'upsert', expense })));
    setImportPreview(null);
    setNotice(`导入完成：新增 ${additions.length} 笔，匹配或跳过 ${duplicates} 笔`);
    setTimeout(() => setNotice(''), 4200);
  }

  function undoLatestImport() {
    if (!latestImport || !window.confirm(`撤销“${latestImport.filename}”导入的 ${latestImport.count} 笔记录吗？`)) return;
    const removed = expensesRef.current.filter((item) => item.batchId === latestImport.batchId);
    setExpenses((current) => current.filter((item) => item.batchId !== latestImport.batchId));
    expensesRef.current = expensesRef.current.filter((item) => item.batchId !== latestImport.batchId);
    queueOperations(removed.map((item) => operation({ kind: 'delete', expenseId: item.id })));
    setNotice('最近一次账单导入已撤销');
    setTimeout(() => setNotice(''), 2600);
  }

  function handleSyncChip() {
    setShowData(true);
    if (syncStatus === 'offline' || syncStatus === 'error') {
      setSyncStatus('connecting');
      syncRunner.current();
    }
  }

  function changeBudget(value: number) {
    budgetRef.current = value;
    setBudget(value);
    queueSettings(value, paymentRef.current);
  }

  function clearAllExpenses() {
    if (!window.confirm('确定清空全部消费记录吗？请先导出备份。')) return;
    const existing = expensesRef.current.filter((item) => !item.demo);
    expensesRef.current = [];
    setExpenses([]);
    queueOperations(existing.map((item) => operation({ kind: 'delete', expenseId: item.id })));
    setShowData(false);
    setNotice('全部记录已清空，正在同步');
    setTimeout(() => setNotice(''), 2600);
  }

  function selectPeriod(nextPeriod: Period) {
    setSelectedMonth(null);
    setTrendSelection(null);
    setShowInsights(false);
    setPeriod(nextPeriod);
  }

  function openYearMonth(month: number) {
    setSelectedMonth(month);
    setTrendSelection(null);
    setPeriod('month');
  }

  function selectTrendSegment(index: number) {
    const next = trendSelectionFor(period, periodDate, index);
    if (!next) return;
    setTrendSelection((current) => current?.start === next.start && current.end === next.end ? null : next);
    window.requestAnimationFrame(() => transactionsPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function openInsights() {
    setTrendSelection(null);
    setSelectedMerchant(null);
    setShowInsights(true);
  }

  function selectMerchant(name: string) {
    const opening = selectedMerchant !== name;
    setSelectedMerchant(opening ? name : null);
    if (opening) window.requestAnimationFrame(() => merchantDetailPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  const periodLabel = period === 'today'
    ? '今日'
    : period === 'week'
      ? '本周'
      : period === 'month'
        ? selectedMonth === null ? '本月' : `${periodDate.getFullYear()}年${periodDate.getMonth() + 1}月`
        : '本年';
  const trendEyebrow = period === 'today' ? '每 4 小时' : period === 'week' ? '周一至周日 · 点击某天查看流水' : period === 'month' ? '每 7 天 · 点击日期段查看流水' : '1 月至 12 月 · 点击月份查看明细';
  const maxTrend = Math.max(...trend.map((day) => day.value), 1);
  const previewTotal = importPreview?.expenses.reduce((sum, item) => sum + item.amount, 0) || 0;
  const previewDates = importPreview?.expenses.map((item) => item.occurredAt).sort() || [];
  const syncLabel = syncStatus === 'synced'
    ? '已同步'
    : syncStatus === 'saving'
      ? pendingCount ? `同步中 · ${pendingCount}` : '同步中'
      : syncStatus === 'connecting'
        ? '连接云端'
        : syncStatus === 'offline'
          ? pendingCount ? `离线 · 待同步 ${pendingCount}` : '离线缓存'
          : pendingCount ? `同步失败 · ${pendingCount}` : '同步失败';

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow live-date">{now ? fullDateLabel(now) : '正在获取本地日期'}</p><h1>消费有迹</h1></div>
        <button className={`privacy-chip sync-${syncStatus}`} type="button" onClick={handleSyncChip}>{syncLabel}</button>
      </header>

      <nav className="period-tabs" aria-label="统计周期">
        {([['today', '今天'], ['week', '本周'], ['month', '本月'], ['year', '本年']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={!showInsights && period === value && selectedMonth === null} onClick={() => selectPeriod(value)}>{label}</button>)}
        <button type="button" aria-pressed={showInsights} onClick={openInsights}>统计</button>
      </nav>

      {!showInsights && selectedMonth !== null && (
        <div className="month-drilldown" role="status">
          <span>正在查看 <strong>{periodLabel}</strong> 的完整统计</span>
          <button type="button" onClick={() => selectPeriod('year')}>返回本年</button>
        </div>
      )}

      {expenses.some((item) => item.demo) && <div className="demo-banner"><span>当前包含示例记录</span><button type="button" onClick={() => setExpenses((current) => current.filter((item) => !item.demo))}>清除示例</button></div>}

      {showInsights ? (
        <div className="statistics-view">
          <div className="insights-toolbar">
            <div><p className="eyebrow">消费去向</p><h2>消费统计</h2></div>
            <div className="insight-scope" role="group" aria-label="统计范围">
              {([['all', '全部'], ['year', '本年'], ['month', '本月'], ['week', '本周']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={insightScope === value} onClick={() => { setInsightScope(value); setSelectedMerchant(null); }}>{label}</button>)}
            </div>
          </div>
          <section className="summary-grid" aria-label="统计概览">
            <article className="summary-card primary-card"><span>累计支出</span><strong>{money(insights.total)}</strong><small>{insights.count} 笔消费</small></article>
            <article className="summary-card"><span>消费商家/用途</span><strong>{insights.merchants.length}</strong><small>个不同名称</small></article>
            <article className="summary-card"><span>平均每笔</span><strong>{money(insights.count ? insights.total / insights.count : 0)}</strong><small>按当前范围计算</small></article>
          </section>

          <div className="insight-grid">
            <section className="panel compact-panel">
              <div className="section-head"><div><p className="eyebrow">钱花在哪</p><h2>消费类型</h2></div><span className="section-note">按金额排序</span></div>
              {insights.categories.length ? <div className="rank-list">{insights.categories.map((row) => <div className="rank-row" key={row.name}><div className="rank-copy"><strong>{row.name}</strong><small>{row.count} 笔 · {insights.total ? Math.round(row.amount / insights.total * 100) : 0}%</small></div><div className="rank-tail"><strong>{money(row.amount)}</strong><i style={{ width: `${insights.total ? row.amount / insights.total * 100 : 0}%` }} /></div></div>)}</div> : <p className="empty compact-empty">当前范围还没有消费记录</p>}
            </section>
            <section className="panel compact-panel">
              <div className="section-head"><div><p className="eyebrow">吃的、喝的、用的</p><h2>常买内容</h2></div><span className="section-note">按次数排序</span></div>
              {insights.contents.length ? <div className="rank-list">{insights.contents.slice(0, 10).map((row) => <div className="rank-row" key={row.name}><div className="rank-copy"><strong>{row.name}</strong><small>{row.count} 笔</small></div><div className="rank-tail"><strong>{money(row.amount)}</strong><i style={{ width: `${insights.contents[0].count ? row.count / insights.contents[0].count * 100 : 0}%` }} /></div></div>)}</div> : <p className="empty compact-empty">记账时填写“消费内容”，即可查看常买的东西。</p>}
              {insights.contents.length > 0 && <p className="insight-footnote">旧账单若没有独立商品字段，会使用导入时保存的商品说明或备注。</p>}
            </section>
          </div>

          <section className="panel merchants-panel">
            <div className="section-head"><div><p className="eyebrow">经常去哪里</p><h2>商家/用途排行</h2></div><span className="section-note">点击查看常买内容</span></div>
            {insights.merchants.length ? <div className="merchant-list">{insights.merchants.slice(0, showAllMerchants ? undefined : 10).map((row, index) => <button className="merchant-row" type="button" key={row.name} aria-pressed={selectedMerchant === row.name} onClick={() => selectMerchant(row.name)}><span className="merchant-index">{index + 1}</span><span className="merchant-copy"><strong>{row.name}</strong><small>{row.count} 笔{row.items.length ? ` · ${row.items.length} 种已记录内容` : ''}</small></span><span className="merchant-amount">{money(row.amount)}</span></button>)}</div> : <p className="empty compact-empty">当前范围还没有商家记录</p>}
            {insights.merchants.length > 10 && <button className="text-button show-more" type="button" onClick={() => setShowAllMerchants((current) => !current)}>{showAllMerchants ? '收起' : `查看全部 ${insights.merchants.length} 个`}</button>}
          </section>

          {merchantDetail && <section className="panel merchant-detail" aria-live="polite" ref={merchantDetailPanel}>
            <div className="section-head"><div><p className="eyebrow">商家详情</p><h2>{merchantDetail.name}</h2></div><button className="text-button" type="button" onClick={() => setSelectedMerchant(null)}>收起</button></div>
            <p className="merchant-summary">共 {merchantDetail.count} 笔 · {money(merchantDetail.amount)}</p>
            <h3>在这里常买</h3>
            {merchantDetail.items.length ? <div className="rank-list">{merchantDetail.items.map((row) => <div className="rank-row" key={row.name}><div className="rank-copy"><strong>{row.name}</strong><small>{row.count} 笔</small></div><div className="rank-tail"><strong>{money(row.amount)}</strong></div></div>)}</div> : <p className="empty compact-empty">这些记录还没有填写具体消费内容；可以点开流水补充。</p>}
            <h3>消费流水</h3>
            <div className="transaction-list">{merchantExpenses.map((item) => <button className="transaction" type="button" key={item.id} onClick={() => openEdit(item)}><PaymentLogo item={item} /><span className="transaction-copy"><strong>{contentName(item) || item.merchant}</strong><span>{item.category} · {item.channel} {item.method} · {item.occurredAt.replace('T', ' ')}</span></span><span className="transaction-amount"><strong>−{money(item.amount)}</strong></span></button>)}</div>
          </section>}
        </div>
      ) : (<>

      <section className="summary-grid" aria-label="消费概览">
        {summaryCards.map((card, index) => <article className={`summary-card${index === 0 ? ' primary-card' : ''}`} key={card.label}><span>{card.label}</span><strong>{card.value}</strong><small>{card.detail}</small></article>)}
      </section>

      <section className="panel heatmap-panel" aria-labelledby="heatmap-title">
        <div className="section-head"><div><p className="eyebrow">{heatmap.year} 年</p><h2 id="heatmap-title">消费热力图</h2></div><span className="section-note">颜色越深，消费越多</span></div>
        <div className="heatmap-layout">
          <div className="heatmap-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>
          <div className="heatmap-scroll" ref={heatmapScroller}>
            <div className="heatmap-content">
              <div className="heatmap-months" aria-hidden="true">{heatmap.months.map((month) => <span key={month.label} style={{ left: `${month.week * 13}px` }}>{month.label}</span>)}</div>
              <div className="heatmap-grid">
                {heatmap.days.map((day, index) => day ? (
                  <button
                    className={`heatmap-cell heat-level-${day.level}`}
                    type="button"
                    key={day.key}
                    aria-label={`${fullDateLabel(day.date)}，消费${money(day.amount)}，${day.count}笔`}
                    aria-pressed={selectedHeatmapDay?.key === day.key}
                    title={`${shortDayLabel(day.key)} · ${money(day.amount)} · ${day.count}笔`}
                    onClick={() => setSelectedHeatmapKey(day.key)}
                  />
                ) : <span className="heatmap-placeholder" key={`empty-${index}`} aria-hidden="true" />)}
              </div>
            </div>
          </div>
        </div>
        <div className="heatmap-footer">
          <div className="heatmap-selection" aria-live="polite"><strong>{selectedHeatmapDay ? fullDateLabel(selectedHeatmapDay.date) : '选择一天查看详情'}</strong><span>{selectedHeatmapDay ? `${money(selectedHeatmapDay.amount)} · ${selectedHeatmapDay.count} 笔` : ''}</span></div>
          <div className="heatmap-legend" aria-label="消费金额颜色图例"><span>少</span>{[0, 1, 2, 3, 4].map((level) => <i className={`heat-level-${level}`} key={level} />)}<span>多</span></div>
        </div>
      </section>

      <section className="panel trend-panel">
        <div className="section-head"><div><p className="eyebrow">{trendEyebrow}</p><h2>{periodLabel}消费趋势</h2></div><span className="section-note">共 {money(trend.reduce((sum, day) => sum + day.value, 0))}</span></div>
        <div className={`trend-chart trend-${period}`} style={{ gridTemplateColumns: `repeat(${trend.length}, minmax(${period === 'year' ? '38px' : '0'}, 1fr))` }} role={period === 'today' ? 'img' : 'group'} aria-label={trend.map((day) => `${day.label}${money(day.value)}`).join('，')}>
          {trend.map((day, index) => {
            const contents = <><span className="trend-value">{day.value ? Math.round(day.value) : ''}</span><span className="trend-bar" style={{ height: `${Math.max(4, day.value / maxTrend * 104)}px` }} /><span>{day.label}</span></>;
            if (period === 'today') return <div className="trend-day" key={day.key}>{contents}</div>;
            const selected = period === 'week' && trendSelection?.source === 'week' && trendSelection.start === day.key
              || period === 'month' && trendSelection?.source === 'month' && trendSelection.start.endsWith(`-${String(index * 7 + 1).padStart(2, '0')}`);
            return <button className="trend-day trend-month-button" type="button" key={day.key} aria-pressed={selected} onClick={() => period === 'year' ? openYearMonth(index) : selectTrendSegment(index)} aria-label={period === 'year' ? `查看${currentYear}年${index + 1}月消费，${money(day.value)}` : `查看${period === 'week' ? shortDayLabel(day.key) : `${periodDate.getMonth() + 1}月${day.label}`}的消费记录，${money(day.value)}`}>{contents}</button>;
          })}
        </div>
      </section>

      <div className="insight-grid">
        <section className="panel compact-panel">
          <div className="section-head"><h2>支付渠道</h2><span className="section-note">{periodLabel}</span></div>
          {channelTotals.map(({ channel, amount, className }) => {
            const percentage = total ? Math.round(amount / total * 100) : 0;
            return <div className="meter-row" key={channel}><span>{channel}</span><div className="meter"><i className={className} style={{ width: `${percentage}%` }} /></div><strong>{percentage}%</strong></div>;
          })}
        </section>
        <section className="panel compact-panel">
          <div className="section-head"><h2>消费分类</h2><span className="section-note">前五项</span></div>
          <div className="category-list">{categoryTotals.length ? categoryTotals.map(([name, value]) => <div key={name}><span>{name}</span><strong>{money(value)}</strong></div>) : <p className="empty compact-empty">暂无数据</p>}</div>
        </section>
      </div>

      <section className="panel transactions-panel" ref={transactionsPanel}>
        <div className="section-head"><div><p className="eyebrow">流水</p><h2>{trendSelection ? trendSelection.label : periodLabel}消费</h2></div><button className="text-button" type="button" onClick={openNew}>新增一笔</button></div>
        {trendSelection && trendSelection.source === period && <div className="transaction-filter"><span>{transactionExpenses.length} 笔 · {money(selectionTotal)}</span><button type="button" onClick={() => setTrendSelection(null)}>查看{periodLabel}全部</button></div>}
        <div className="transaction-list">
          {transactionExpenses.length === 0 ? <p className="empty">这个日期范围还没有消费记录。</p> : transactionExpenses.map((item) => (
            <button className="transaction" type="button" key={item.id} onClick={() => openEdit(item)}>
              <PaymentLogo item={item} />
              <span className="transaction-copy"><strong>{item.merchant}</strong><span>{item.itemName ? `${item.itemName} · ` : ''}{item.category} · {item.channel} {item.method}{item.demo ? ' · 示例' : item.source === 'import' ? ' · 导入' : ''}</span></span>
              <span className="transaction-amount"><strong>−{money(item.amount)}</strong><span>{new Date(item.occurredAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
            </button>
          ))}
        </div>
      </section>

      </>)}

      <button className="fab" type="button" onClick={openNew} aria-label="新增一笔消费">＋</button>
      {notice && <div className="toast" role="status">{notice}</div>}

      {showAdd && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowAdd(false)}>
          <section className="add-sheet" role="dialog" aria-modal="true" aria-labelledby="add-title">
            <div className="sheet-handle" />
            <div className="section-head"><h2 id="add-title">{editingId ? '修改消费' : '记一笔消费'}</h2><button className="close-button" type="button" onClick={() => setShowAdd(false)}>取消</button></div>
            <form onSubmit={saveExpense}>
              <label>金额<input className="amount-input" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} type="number" inputMode="decimal" min="0.01" step="0.01" placeholder="0.00" autoFocus required /></label>
              <label>商家或用途<input value={draft.merchant} onChange={(event) => setDraft({ ...draft, merchant: event.target.value })} type="text" placeholder="例如：午餐" /></label>
              <label>消费内容（可选）<input value={draft.itemName || ''} onChange={(event) => setDraft({ ...draft, itemName: event.target.value })} type="text" placeholder="例如：鸡腿饭、拿铁、纸巾" /></label>
              <label>消费类型
                <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
                  {!categories.includes(draft.category) && <option value={draft.category}>{draft.category}</option>}
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <fieldset className="payment-picker">
                <legend>付款方式 <span>会记住本次选择</span></legend>
                <div className="payment-grid">
                  {paymentPresets.map((payment) => {
                    const selected = draft.channel === payment.channel && draft.method === payment.method;
                    return <button className="payment-card-choice" key={payment.label} type="button" aria-label={payment.label} aria-pressed={selected} onClick={() => choosePayment(payment)}><span className="payment-card-art" style={{ backgroundImage: `url(${payment.image})` }} aria-hidden="true" /><span className="payment-card-check" aria-hidden="true">✓</span><strong>{payment.label}</strong><small>{payment.detail}</small></button>;
                  })}
                </div>
              </fieldset>
              <button className="save-button" type="submit">{editingId ? '保存修改' : `保存 · ${draft.channel}${draft.method}`}</button>
              <details className="advanced-fields">
                <summary>更多信息（时间、备注）</summary>
                <div className="advanced-fields-body">
                  <div className="form-row">
                    <label>渠道<select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as Channel })}>{channels.map((channel) => <option key={channel}>{channel}</option>)}</select></label>
                    <label>付款方式<select value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{methods.map((method) => <option key={method}>{method}</option>)}</select></label>
                  </div>
                  <label>时间<input value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} type="datetime-local" /></label>
                  <label>备注（可选）<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} type="text" placeholder="例如：和朋友聚餐" /></label>
                </div>
              </details>
              {editingId && <button className="delete-button" type="button" onClick={removeExpense}>删除这条记录</button>}
            </form>
          </section>
        </div>
      )}

      {showData && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowData(false)}>
          <section className="add-sheet data-sheet" role="dialog" aria-modal="true" aria-labelledby="data-title">
            <div className="sheet-handle" />
            <div className="section-head"><div><p className="eyebrow">设置与备份</p><h2 id="data-title">同步与数据</h2></div><button className="close-button" type="button" onClick={() => setShowData(false)}>完成</button></div>
            <div className="sync-card">
              <div><strong>{syncLabel}</strong><span>{pendingCount ? `本机还有 ${pendingCount} 项更改等待上传` : '手机与电脑使用同一份云端账本'}</span></div>
              {(syncStatus === 'offline' || syncStatus === 'error') && <button type="button" onClick={() => { setSyncStatus('connecting'); syncRunner.current(); }}>重新同步</button>}
            </div>
            <div className="data-section">
              <label>每月预算<input type="number" inputMode="decimal" min="0" step="100" value={budget} onChange={(event) => changeBudget(Number(event.target.value) || 0)} /></label>
            </div>
            {isIos && !isStandalone && <div className="data-section install-section">
              <h3>添加到 iPhone 主屏幕</h3>
              <p>安装后会像普通 App 一样独立打开，不再显示 Safari 地址栏；账单仍与电脑自动同步。</p>
              <button className="outline-button install-button" type="button" onClick={() => setShowInstallHelp(true)}>查看安装步骤</button>
            </div>}
            <div className="data-section">
              <h3>备份与导出</h3>
              <p>记录会在使用同一账号打开的手机和电脑间自动同步，同时保留本机缓存。仍建议每月导出一次完整备份。</p>
              <div className="action-grid"><button type="button" onClick={exportJson}>导出完整备份</button><button type="button" onClick={exportCsv}>导出 CSV</button></div>
            </div>
            <div className="data-section">
              <h3>导入官方账单</h3>
              <p>支持微信、支付宝解压后的 CSV 明细，以及本应用 JSON 备份。导入前会先预览，收入、退款和失败交易不会计入消费。</p>
              <input ref={fileInput} className="sr-only" type="file" accept=".json,.csv,.zip,.xls,.xlsx,text/csv,application/json" onChange={importFile} />
              <button className="outline-button import-button" type="button" onClick={() => fileInput.current?.click()}>选择微信或支付宝账单</button>
              <p className="import-hint">如果下载的是 ZIP，请先在 iPhone“文件”App 中轻点解压，再选择其中的 CSV。</p>
              {latestImport && <div className="latest-import"><div><strong>最近导入</strong><span>{latestImport.filename} · {latestImport.count} 笔</span></div><button type="button" onClick={undoLatestImport}>撤销</button></div>}
            </div>
            <div className="data-section shortcut-help">
              <h3>快捷指令入口</h3>
              <p>一个快捷指令就够了：只传金额和用途，付款方式会沿用你上一次的选择，也可以在保存前点一下切换。</p>
              <code>?amount=38.6&amp;merchant=午餐</code>
            </div>
            <div className="data-section danger-zone"><button type="button" onClick={clearAllExpenses}>清空全部记录</button></div>
          </section>
        </div>
      )}

      {showInstallHelp && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowInstallHelp(false)}>
          <section className="add-sheet install-sheet" role="dialog" aria-modal="true" aria-labelledby="install-title">
            <div className="sheet-handle" />
            <div className="section-head"><div><p className="eyebrow">iPhone 网页 App</p><h2 id="install-title">添加“消费有迹”到主屏幕</h2></div><button className="close-button" type="button" onClick={() => setShowInstallHelp(false)}>完成</button></div>
            <ol className="install-steps">
              <li><b>1</b><span>请用 Safari 打开当前页面，轻点底部的“共享”按钮。</span></li>
              <li><b>2</b><span>向下滑动并选择“添加到主屏幕”。</span></li>
              <li><b>3</b><span>打开“作为网页 App 打开”，然后轻点右上角“添加”。</span></li>
            </ol>
            <p className="install-note">首次从桌面图标打开时，如果出现登录页面，请使用电脑端相同的账号登录。看到右上角“已同步”后即可正常使用。</p>
          </section>
        </div>
      )}

      {importPreview && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setImportPreview(null)}>
          <section className="add-sheet import-sheet" role="dialog" aria-modal="true" aria-labelledby="import-title">
            <div className="sheet-handle" />
            <div className="section-head"><div><p className="eyebrow">账单预览</p><h2 id="import-title">确认导入</h2></div><button className="close-button" type="button" onClick={() => setImportPreview(null)}>取消</button></div>
            <div className="import-file"><strong>{importPreview.filename}</strong><span>{importPreview.encoding} · 已识别官方账单结构</span></div>
            <label className="channel-select">账单来源<select value={importPreview.channel} onChange={(event) => setImportPreview({ ...importPreview, channel: event.target.value as Channel })}><option>微信</option><option>支付宝</option></select></label>
            <div className="import-stats">
              <div><span>有效支出</span><strong>{importPreview.expenses.length} 笔</strong></div>
              <div><span>支出合计</span><strong>{money(previewTotal)}</strong></div>
              <div><span>排除记录</span><strong>{importPreview.ignored} 笔</strong></div>
            </div>
            <p className="date-range">范围：{previewDates[0]?.slice(0, 10)} 至 {previewDates.at(-1)?.slice(0, 10)}</p>
            <div className="preview-list" aria-label="账单记录示例">
              {importPreview.expenses.slice(0, 4).map((item) => <div key={item.id}><span><strong>{item.merchant}</strong><small>{item.occurredAt.replace('T', ' ')} · {item.category}</small></span><b>−{money(item.amount)}</b></div>)}
            </div>
            <p className="reconcile-note">正式导入时会按交易号去重；没有交易号时，会用渠道、金额和时间匹配已有手工记录。</p>
            <button className="save-button import-confirm" type="button" onClick={confirmBillImport}>确认导入并自动去重</button>
          </section>
        </div>
      )}
    </main>
  );
}
