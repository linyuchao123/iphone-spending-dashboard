'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';

type Channel = '微信' | '支付宝';
type Period = 'today' | 'week' | 'month';
type Expense = {
  id: string;
  amount: number;
  merchant: string;
  category: string;
  channel: Channel;
  method: string;
  occurredAt: string;
  note?: string;
  source?: 'manual' | 'import';
  demo?: boolean;
};
type Draft = Omit<Expense, 'id' | 'source' | 'demo'> & { amount: string };

const STORAGE_KEY = 'spending-trace-expenses-v1';
const SETTINGS_KEY = 'spending-trace-settings-v1';
const categories = ['餐饮', '交通', '购物', '日用', '娱乐', '住房', '医疗', '人情', '其他'];
const methods = ['零钱', '花呗', '银行卡', '余额', '其他'];

function localDateTime(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function makeDraft(): Draft {
  return { amount: '', merchant: '', category: '餐饮', channel: '微信', method: '零钱', occurredAt: localDateTime(), note: '' };
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

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isInPeriod(value: string, period: Period) {
  const date = new Date(value);
  const now = new Date();
  if (period === 'today') return dateKey(date) === dateKey(now);
  if (period === 'month') return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
  const monday = new Date(now);
  const day = monday.getDay() || 7;
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - day + 1);
  return date >= monday && date <= now;
}

function csvEscape(value: string | number) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && quoted && line[index + 1] === '"') { current += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { cells.push(current.trim()); current = ''; }
    else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function pick(row: Record<string, string>, names: string[]) {
  for (const name of names) if (row[name]) return row[name];
  return '';
}

function parseExpenseCsv(text: string, filename: string): Expense[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  const headerIndex = lines.findIndex((line) => /交易时间|时间/.test(line) && /金额/.test(line));
  if (headerIndex < 0) throw new Error('没有找到包含“交易时间”和“金额”的表头');
  const headers = parseCsvLine(lines[headerIndex]).map((cell) => cell.replaceAll(' ', ''));
  const inferredChannel: Channel = /支付宝|alipay/i.test(filename + text.slice(0, 300)) ? '支付宝' : '微信';
  return lines.slice(headerIndex + 1).map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || '']));
    const direction = pick(row, ['收/支', '收支', '收支类型', '交易类型']);
    const status = pick(row, ['交易状态', '当前状态']);
    if (/收入|退款|已退款/.test(direction + status)) return null;
    const amount = Number(pick(row, ['金额(元)', '金额（元）', '金额', '交易金额']).replace(/[¥￥,\s]/g, ''));
    const rawTime = pick(row, ['交易时间', '时间', '创建时间', '付款时间']).replaceAll('/', '-');
    if (!Number.isFinite(amount) || amount <= 0 || !rawTime) return null;
    const occurredAt = rawTime.length >= 16 ? rawTime.slice(0, 16).replace(' ', 'T') : localDateTime();
    const merchant = pick(row, ['交易对方', '交易对象', '商户名称', '商品', '商品说明', '交易说明']) || '账单导入';
    const method = pick(row, ['支付方式', '支付渠道', '付款方式']) || inferredChannel;
    return { id: `import-${Date.now()}-${index}`, amount, merchant, category: '其他', channel: inferredChannel, method, occurredAt, source: 'import' as const };
  }).filter((item): item is Expense => item !== null);
}

function signature(item: Expense) {
  return `${item.occurredAt.slice(0, 16)}|${item.amount.toFixed(2)}|${item.merchant.replaceAll(' ', '')}`;
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [period, setPeriod] = useState<Period>('month');
  const [budget, setBudget] = useState(5000);
  const [ready, setReady] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showData, setShowData] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(makeDraft());
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        const settings = window.localStorage.getItem(SETTINGS_KEY);
        setExpenses(saved ? JSON.parse(saved) : demoData());
        if (settings) setBudget(Number(JSON.parse(settings).budget) || 5000);
      } catch { setExpenses(demoData()); }
      setReady(true);

      const params = new URLSearchParams(window.location.search);
      const amount = params.get('amount');
      if (amount) {
        setDraft({ ...makeDraft(), amount, merchant: params.get('merchant') || '', channel: params.get('channel') === '支付宝' ? '支付宝' : '微信', method: params.get('method') || '银行卡' });
        setShowAdd(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => { if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(expenses)); }, [expenses, ready]);
  useEffect(() => { if (ready) window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ budget })); }, [budget, ready]);

  const visible = useMemo(() => expenses.filter((item) => isInPeriod(item.occurredAt, period)).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)), [expenses, period]);
  const total = useMemo(() => visible.reduce((sum, item) => sum + item.amount, 0), [visible]);
  const todayTotal = useMemo(() => expenses.filter((item) => isInPeriod(item.occurredAt, 'today')).reduce((sum, item) => sum + item.amount, 0), [expenses]);
  const monthTotal = useMemo(() => expenses.filter((item) => isInPeriod(item.occurredAt, 'month')).reduce((sum, item) => sum + item.amount, 0), [expenses]);

  const categoryTotals = useMemo(() => {
    const values = new Map<string, number>();
    visible.forEach((item) => values.set(item.category, (values.get(item.category) || 0) + item.amount));
    return [...values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [visible]);

  const channelTotals = useMemo(() => {
    const wechat = visible.filter((item) => item.channel === '微信').reduce((sum, item) => sum + item.amount, 0);
    return { wechat, alipay: total - wechat };
  }, [visible, total]);

  const trend = useMemo(() => {
    const result = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - index));
      return { key: dateKey(date), label: index === 6 ? '今天' : `${date.getMonth() + 1}/${date.getDate()}`, value: 0 };
    });
    expenses.forEach((item) => { const target = result.find((day) => day.key === dateKey(new Date(item.occurredAt))); if (target) target.value += item.amount; });
    return result;
  }, [expenses]);

  function openNew() { setEditingId(null); setDraft(makeDraft()); setShowAdd(true); }
  function openEdit(item: Expense) { setEditingId(item.id); setDraft({ amount: String(item.amount), merchant: item.merchant, category: item.category, channel: item.channel, method: item.method, occurredAt: item.occurredAt, note: item.note || '' }); setShowAdd(true); }

  function saveExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(draft.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setNotice('请输入正确的消费金额'); return; }
    if (editingId) {
      setExpenses((current) => current.map((item) => item.id === editingId ? { ...item, ...draft, amount, demo: false } : item));
      setNotice('记录已更新');
    } else {
      setExpenses((current) => [{ ...draft, id: crypto.randomUUID(), amount, source: 'manual' }, ...current]);
      setNotice('已保存到本机');
    }
    setShowAdd(false);
    setTimeout(() => setNotice(''), 2200);
  }

  function removeExpense() {
    if (!editingId || !window.confirm('确定删除这条消费记录吗？')) return;
    setExpenses((current) => current.filter((item) => item.id !== editingId));
    setShowAdd(false);
    setNotice('记录已删除');
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
    const header = ['时间', '金额', '商家', '分类', '渠道', '付款方式', '备注'];
    const rows = expenses.map((item) => [item.occurredAt.replace('T', ' '), item.amount, item.merchant, item.category, item.channel, item.method, item.note || ''].map(csvEscape).join(','));
    download(`消费记录-${dateKey(new Date())}.csv`, `\uFEFF${header.map(csvEscape).join(',')}\n${rows.join('\n')}`, 'text/csv;charset=utf-8');
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      let incoming: Expense[];
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text);
        incoming = Array.isArray(parsed) ? parsed : parsed.expenses;
        if (!Array.isArray(incoming)) throw new Error('备份中没有消费记录');
        if (parsed.budget) setBudget(Number(parsed.budget));
      } else incoming = parseExpenseCsv(text, file.name);
      const known = new Set(expenses.map(signature));
      const unique = incoming.filter((item) => !known.has(signature(item)));
      setExpenses((current) => [...unique, ...current]);
      setNotice(`成功导入 ${unique.length} 笔，跳过 ${incoming.length - unique.length} 笔重复记录`);
      setShowData(false);
    } catch (error) { setNotice(`导入失败：${error instanceof Error ? error.message : '文件格式不正确'}`); }
    event.target.value = '';
    setTimeout(() => setNotice(''), 3800);
  }

  const periodLabel = period === 'today' ? '今日' : period === 'week' ? '本周' : '本月';
  const maxTrend = Math.max(...trend.map((day) => day.value), 1);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div><p className="eyebrow">本地账本</p><h1>消费有迹</h1></div>
        <button className="privacy-chip" type="button" onClick={() => setShowData(true)}>仅此设备 · 管理</button>
      </header>

      <nav className="period-tabs" aria-label="统计周期">
        {([['today', '今天'], ['week', '本周'], ['month', '本月']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)}>{label}</button>)}
      </nav>

      {expenses.some((item) => item.demo) && <div className="demo-banner"><span>当前包含示例记录</span><button type="button" onClick={() => setExpenses((current) => current.filter((item) => !item.demo))}>清除示例</button></div>}

      <section className="summary-grid" aria-label="消费概览">
        <article className="summary-card primary-card"><span>{periodLabel}支出</span><strong>{money(total)}</strong><small>{visible.length} 笔消费</small></article>
        <article className="summary-card"><span>今日支出</span><strong>{money(todayTotal)}</strong><small>{expenses.filter((item) => isInPeriod(item.occurredAt, 'today')).length} 笔</small></article>
        <article className="summary-card"><span>月预算剩余</span><strong>{money(Math.max(0, budget - monthTotal))}</strong><small>预算 {money(budget)}</small></article>
      </section>

      <section className="panel trend-panel">
        <div className="section-head"><div><p className="eyebrow">近 7 天</p><h2>每日趋势</h2></div><span className="section-note">共 {money(trend.reduce((sum, day) => sum + day.value, 0))}</span></div>
        <div className="trend-chart" role="img" aria-label={trend.map((day) => `${day.label}${money(day.value)}`).join('，')}>
          {trend.map((day) => <div className="trend-day" key={day.key}><span className="trend-value">{day.value ? Math.round(day.value) : ''}</span><div className="trend-bar" style={{ height: `${Math.max(4, day.value / maxTrend * 104)}px` }} /><span>{day.label}</span></div>)}
        </div>
      </section>

      <div className="insight-grid">
        <section className="panel compact-panel">
          <div className="section-head"><h2>支付渠道</h2><span className="section-note">{periodLabel}</span></div>
          {[['微信', channelTotals.wechat, 'wechat'], ['支付宝', channelTotals.alipay, 'alipay']].map(([label, value, className]) => {
            const amount = Number(value); const percentage = total ? Math.round(amount / total * 100) : 0;
            return <div className="meter-row" key={label}><span>{label}</span><div className="meter"><i className={String(className)} style={{ width: `${percentage}%` }} /></div><strong>{percentage}%</strong></div>;
          })}
        </section>
        <section className="panel compact-panel">
          <div className="section-head"><h2>消费分类</h2><span className="section-note">前五项</span></div>
          <div className="category-list">{categoryTotals.length ? categoryTotals.map(([name, value]) => <div key={name}><span>{name}</span><strong>{money(value)}</strong></div>) : <p className="empty compact-empty">暂无数据</p>}</div>
        </section>
      </div>

      <section className="panel transactions-panel">
        <div className="section-head"><div><p className="eyebrow">流水</p><h2>{periodLabel}消费</h2></div><button className="text-button" type="button" onClick={openNew}>新增一笔</button></div>
        <div className="transaction-list">
          {visible.length === 0 ? <p className="empty">这个周期还没有消费记录。</p> : visible.map((item) => (
            <button className="transaction" type="button" key={item.id} onClick={() => openEdit(item)}>
              <span className={`channel-mark ${item.channel === '支付宝' ? 'alipay' : ''}`}>{item.channel === '微信' ? '微' : '支'}</span>
              <span className="transaction-copy"><strong>{item.merchant}</strong><span>{item.category} · {item.method}{item.demo ? ' · 示例' : item.source === 'import' ? ' · 导入' : ''}</span></span>
              <span className="transaction-amount"><strong>−{money(item.amount)}</strong><span>{new Date(item.occurredAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></span>
            </button>
          ))}
        </div>
      </section>

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
              <div className="form-row">
                <label>渠道<select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as Channel })}><option>微信</option><option>支付宝</option></select></label>
                <label>付款方式<select value={draft.method} onChange={(event) => setDraft({ ...draft, method: event.target.value })}>{methods.map((method) => <option key={method}>{method}</option>)}</select></label>
              </div>
              <div className="form-row">
                <label>分类<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></label>
                <label>时间<input value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} type="datetime-local" /></label>
              </div>
              <label>备注（可选）<input value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} type="text" placeholder="例如：和朋友聚餐" /></label>
              <button className="save-button" type="submit">{editingId ? '保存修改' : '保存到本机'}</button>
              {editingId && <button className="delete-button" type="button" onClick={removeExpense}>删除这条记录</button>}
            </form>
          </section>
        </div>
      )}

      {showData && (
        <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setShowData(false)}>
          <section className="add-sheet data-sheet" role="dialog" aria-modal="true" aria-labelledby="data-title">
            <div className="sheet-handle" />
            <div className="section-head"><div><p className="eyebrow">设置与备份</p><h2 id="data-title">本机数据</h2></div><button className="close-button" type="button" onClick={() => setShowData(false)}>完成</button></div>
            <div className="data-section">
              <label>每月预算<input type="number" inputMode="decimal" min="0" step="100" value={budget} onChange={(event) => setBudget(Number(event.target.value) || 0)} /></label>
            </div>
            <div className="data-section">
              <h3>备份与导出</h3>
              <p>记录只存在当前浏览器。建议每月导出一次完整备份。</p>
              <div className="action-grid"><button type="button" onClick={exportJson}>导出完整备份</button><button type="button" onClick={exportCsv}>导出 CSV</button></div>
            </div>
            <div className="data-section">
              <h3>导入记录</h3>
              <p>支持本应用 JSON 备份，以及包含“交易时间”和“金额”列的微信或支付宝 CSV 账单；重复记录会自动跳过。</p>
              <input ref={fileInput} className="sr-only" type="file" accept=".json,.csv,text/csv,application/json" onChange={importFile} />
              <button className="outline-button" type="button" onClick={() => fileInput.current?.click()}>选择账单或备份文件</button>
            </div>
            <div className="data-section shortcut-help">
              <h3>快捷指令入口</h3>
              <p>以后可以让快捷指令打开下面这种地址，金额和付款方式会自动填入，再确认保存：</p>
              <code>?amount=38.6&amp;merchant=午餐&amp;channel=支付宝&amp;method=花呗</code>
            </div>
            <div className="data-section danger-zone"><button type="button" onClick={() => { if (window.confirm('确定清空本机的全部消费记录吗？请先导出备份。')) { setExpenses([]); setShowData(false); } }}>清空全部记录</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
