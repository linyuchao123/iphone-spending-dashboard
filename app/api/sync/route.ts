import { env } from 'cloudflare:workers';
import {
  createAccountSettingsTable,
  createExpenseRecordsTable,
  createExpenseRevisionIndex,
  createProcessedOperationsTable,
  createSyncMetaTable,
  createUserStateTable,
} from '@/db/schema';
import type { Channel, Expense, PaymentChoice, SyncChange, SyncOperation, SyncResponse } from '@/lib/sync-types';

export const dynamic = 'force-dynamic';

type LegacyState = {
  version: 1;
  budget: number;
  expenses: Expense[];
  lastPayment?: PaymentChoice;
};

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

function userId(request: Request) {
  const authenticated = request.headers.get('oai-authenticated-user-id');
  if (authenticated) return authenticated;
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' ? request.headers.get('x-preview-user') || 'local-preview-user' : null;
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

function validChannel(value: unknown): value is Channel {
  return value === '微信' || value === '支付宝';
}

function sanitizePayment(value: unknown): PaymentChoice | null {
  if (!value || typeof value !== 'object') return null;
  const payment = value as Record<string, unknown>;
  if (!validChannel(payment.channel) || typeof payment.method !== 'string' || !payment.method || payment.method.length > 40) return null;
  return { channel: payment.channel, method: payment.method };
}

function sanitizeExpense(value: unknown): Expense | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !item.id || item.id.length > 160) return null;
  if (typeof item.amount !== 'number' || !Number.isFinite(item.amount) || item.amount <= 0 || item.amount > 1_000_000_000) return null;
  if (typeof item.merchant !== 'string' || item.merchant.length > 300 || typeof item.category !== 'string' || item.category.length > 80) return null;
  if (!validChannel(item.channel) || typeof item.method !== 'string' || item.method.length > 80 || typeof item.occurredAt !== 'string' || item.occurredAt.length > 40) return null;
  const optional = (key: string, max: number) => typeof item[key] === 'string' && item[key] ? String(item[key]).slice(0, max) : undefined;
  return {
    id: item.id,
    amount: item.amount,
    merchant: item.merchant.slice(0, 300),
    category: item.category.slice(0, 80),
    channel: item.channel,
    method: item.method.slice(0, 80),
    occurredAt: item.occurredAt,
    note: optional('note', 500),
    source: item.source === 'import' ? 'import' : 'manual',
    externalId: optional('externalId', 200),
    batchId: optional('batchId', 200),
    importedAt: optional('importedAt', 40),
    sourceFile: optional('sourceFile', 300),
  };
}

function sanitizeOperation(value: unknown): SyncOperation | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.operationId !== 'string' || !item.operationId || item.operationId.length > 160) return null;
  if (typeof item.deviceId !== 'string' || !item.deviceId || item.deviceId.length > 160) return null;
  if (typeof item.queuedAt !== 'string' || item.queuedAt.length > 40) return null;
  const base = { operationId: item.operationId, deviceId: item.deviceId, queuedAt: item.queuedAt };
  if (item.kind === 'upsert') {
    const expense = sanitizeExpense(item.expense);
    return expense ? { ...base, kind: 'upsert', expense } : null;
  }
  if (item.kind === 'delete') {
    return typeof item.expenseId === 'string' && item.expenseId && item.expenseId.length <= 160 ? { ...base, kind: 'delete', expenseId: item.expenseId } : null;
  }
  if (item.kind === 'settings' && item.settings && typeof item.settings === 'object') {
    const settings = item.settings as Record<string, unknown>;
    const payment = sanitizePayment(settings.lastPayment);
    const budget = Number(settings.budget);
    return payment && Number.isFinite(budget) && budget >= 0 && budget <= 1_000_000_000 ? { ...base, kind: 'settings', settings: { budget, lastPayment: payment } } : null;
  }
  return null;
}

async function initialize(owner: string) {
  const db = database();
  await db.batch([
    db.prepare(createUserStateTable),
    db.prepare(createSyncMetaTable),
    db.prepare(createExpenseRecordsTable),
    db.prepare(createAccountSettingsTable),
    db.prepare(createProcessedOperationsTable),
    db.prepare(createExpenseRevisionIndex),
  ]);
  await db.prepare('INSERT OR IGNORE INTO sync_meta (user_id, revision, migration_completed) VALUES (?, 0, 0)').bind(owner).run();
  await migrateLegacyState(owner);
}

async function migrateLegacyState(owner: string) {
  const db = database();
  const meta = await db.prepare('SELECT revision, migration_completed FROM sync_meta WHERE user_id = ?').bind(owner).first<{ revision: number; migration_completed: number }>();
  if (meta?.migration_completed) return;
  const legacy = await db.prepare('SELECT payload FROM user_state WHERE user_id = ?').bind(owner).first<{ payload: string }>();
  let revision = meta?.revision || 0;
  if (legacy?.payload) {
    try {
      const state = JSON.parse(legacy.payload) as LegacyState;
      const expenses = Array.isArray(state.expenses) ? state.expenses.map(sanitizeExpense).filter((item): item is Expense => Boolean(item)) : [];
      if (expenses.length) revision += 1;
      for (let index = 0; index < expenses.length; index += 50) {
        const now = new Date().toISOString();
        await db.batch(expenses.slice(index, index + 50).map((item) => db.prepare(`
          INSERT OR IGNORE INTO expense_records (user_id, expense_id, payload, updated_revision, deleted, updated_at)
          VALUES (?, ?, ?, ?, 0, ?)
        `).bind(owner, item.id, JSON.stringify(item), revision, now)));
      }
      const payment = sanitizePayment(state.lastPayment) || { channel: '微信' as const, method: '零钱' };
      const budget = Number.isFinite(Number(state.budget)) ? Number(state.budget) : 5000;
      await db.prepare(`
        INSERT INTO account_settings (user_id, budget, last_channel, last_method, updated_revision, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO NOTHING
      `).bind(owner, budget, payment.channel, payment.method, revision, new Date().toISOString()).run();
    } catch { /* A malformed legacy snapshot must not block the new sync model. */ }
  }
  await db.prepare('UPDATE sync_meta SET revision = ?, migration_completed = 1 WHERE user_id = ?').bind(revision, owner).run();
}

async function nextRevision(owner: string) {
  const row = await database().prepare('UPDATE sync_meta SET revision = revision + 1 WHERE user_id = ? RETURNING revision').bind(owner).first<{ revision: number }>();
  if (!row) throw new Error('无法生成同步版本');
  return row.revision;
}

async function applyOperation(owner: string, operation: SyncOperation) {
  const db = database();
  const processed = await db.prepare('SELECT revision FROM processed_operations WHERE user_id = ? AND operation_id = ?').bind(owner, operation.operationId).first<{ revision: number }>();
  if (processed) return processed.revision;
  const revision = await nextRevision(owner);
  const now = new Date().toISOString();

  if (operation.kind === 'upsert') {
    await db.prepare(`
      INSERT INTO expense_records (user_id, expense_id, payload, updated_revision, deleted, updated_at)
      VALUES (?, ?, ?, ?, 0, ?)
      ON CONFLICT(user_id, expense_id) DO UPDATE SET
        payload = excluded.payload,
        updated_revision = excluded.updated_revision,
        deleted = 0,
        updated_at = excluded.updated_at
    `).bind(owner, operation.expense.id, JSON.stringify(operation.expense), revision, now).run();
  } else if (operation.kind === 'delete') {
    await db.prepare(`
      INSERT INTO expense_records (user_id, expense_id, payload, updated_revision, deleted, updated_at)
      VALUES (?, ?, NULL, ?, 1, ?)
      ON CONFLICT(user_id, expense_id) DO UPDATE SET
        payload = NULL,
        updated_revision = excluded.updated_revision,
        deleted = 1,
        updated_at = excluded.updated_at
    `).bind(owner, operation.expenseId, revision, now).run();
  } else {
    await db.prepare(`
      INSERT INTO account_settings (user_id, budget, last_channel, last_method, updated_revision, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        budget = excluded.budget,
        last_channel = excluded.last_channel,
        last_method = excluded.last_method,
        updated_revision = excluded.updated_revision,
        updated_at = excluded.updated_at
    `).bind(owner, operation.settings.budget, operation.settings.lastPayment.channel, operation.settings.lastPayment.method, revision, now).run();
  }

  await db.prepare('INSERT OR IGNORE INTO processed_operations (user_id, operation_id, device_id, revision, processed_at) VALUES (?, ?, ?, ?, ?)').bind(owner, operation.operationId, operation.deviceId, revision, now).run();
  return revision;
}

async function syncResponse(owner: string, since: number, acceptedOperationIds: string[] = [], includeLegacyState = false): Promise<SyncResponse> {
  const db = database();
  const meta = await db.prepare('SELECT revision FROM sync_meta WHERE user_id = ?').bind(owner).first<{ revision: number }>();
  const revision = meta?.revision || 0;
  const rows = await db.prepare(`
    SELECT expense_id, payload, deleted, updated_revision
    FROM expense_records
    WHERE user_id = ? AND updated_revision > ? AND updated_revision <= ?
    ORDER BY updated_revision ASC
  `).bind(owner, since, revision).all<{ expense_id: string; payload: string | null; deleted: number; updated_revision: number }>();
  const changes: SyncChange[] = rows.results.flatMap<SyncChange>((row) => {
    if (row.deleted) return [{ kind: 'delete' as const, expenseId: row.expense_id, revision: row.updated_revision }];
    if (!row.payload) return [];
    try {
      const expense = sanitizeExpense(JSON.parse(row.payload));
      return expense ? [{ kind: 'upsert' as const, expense, revision: row.updated_revision }] : [];
    } catch { return []; }
  });
  const settingsRow = await db.prepare('SELECT budget, last_channel, last_method, updated_revision FROM account_settings WHERE user_id = ?').bind(owner).first<{ budget: number; last_channel: string; last_method: string; updated_revision: number }>();
  const lastPayment: PaymentChoice = validChannel(settingsRow?.last_channel) ? { channel: settingsRow.last_channel, method: settingsRow?.last_method || '零钱' } : { channel: '微信', method: '零钱' };
  const settings = { budget: Number(settingsRow?.budget) || 5000, lastPayment, revision: settingsRow?.updated_revision || 0 };
  const serverTime = new Date().toISOString();
  const result: SyncResponse = { revision, changes, settings, acceptedOperationIds, serverTime };
  if (!includeLegacyState) return result;
  const allRows = await db.prepare('SELECT payload FROM expense_records WHERE user_id = ? AND deleted = 0 ORDER BY updated_revision DESC').bind(owner).all<{ payload: string }>();
  const expenses = allRows.results.flatMap((row) => {
    try { const expense = sanitizeExpense(JSON.parse(row.payload)); return expense ? [expense] : []; } catch { return []; }
  });
  return { ...result, state: { version: 1, budget: settings.budget, expenses, lastPayment }, updatedAt: serverTime };
}

function parseSince(request: Request, bodySince?: unknown) {
  const raw = bodySince ?? new URL(request.url).searchParams.get('since') ?? 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function GET(request: Request) {
  const owner = userId(request);
  if (!owner) return response({ error: '请先登录后同步' }, 401);
  await initialize(owner);
  const hasSince = new URL(request.url).searchParams.has('since');
  return response(await syncResponse(owner, parseSince(request), [], !hasSince));
}

export async function POST(request: Request) {
  const owner = userId(request);
  if (!owner) return response({ error: '请先登录后同步' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return response({ error: '请求来源无效' }, 403);
  const body = await request.json() as { since?: unknown; operations?: unknown[] };
  if (!Array.isArray(body.operations) || body.operations.length > 200) return response({ error: '同步操作数量无效' }, 400);
  const operations = body.operations.map(sanitizeOperation);
  if (operations.some((item) => !item)) return response({ error: '同步操作格式无效' }, 400);
  await initialize(owner);
  const acceptedOperationIds: string[] = [];
  for (const operation of operations as SyncOperation[]) {
    await applyOperation(owner, operation);
    acceptedOperationIds.push(operation.operationId);
  }
  return response(await syncResponse(owner, parseSince(request, body.since), acceptedOperationIds));
}

// Compatibility for cached clients from the previous full-snapshot release.
export async function PUT(request: Request) {
  const owner = userId(request);
  if (!owner) return response({ error: '请先登录后同步' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return response({ error: '请求来源无效' }, 403);
  const state = await request.json() as LegacyState;
  if (state.version !== 1 || !Array.isArray(state.expenses) || !Number.isFinite(Number(state.budget))) return response({ error: '账本数据格式无效' }, 400);
  await initialize(owner);
  const sanitized = state.expenses.map(sanitizeExpense).filter((item): item is Expense => Boolean(item));
  const current = await database().prepare('SELECT expense_id FROM expense_records WHERE user_id = ? AND deleted = 0').bind(owner).all<{ expense_id: string }>();
  const incomingIds = new Set(sanitized.map((item) => item.id));
  const seed = `${Date.now()}-${crypto.randomUUID()}`;
  const operations: SyncOperation[] = [
    ...sanitized.map((expense, index): SyncOperation => ({ operationId: `legacy-upsert-${seed}-${index}`, deviceId: 'legacy-client', queuedAt: new Date().toISOString(), kind: 'upsert', expense })),
    ...current.results.filter((row) => !incomingIds.has(row.expense_id)).map((row, index): SyncOperation => ({ operationId: `legacy-delete-${seed}-${index}`, deviceId: 'legacy-client', queuedAt: new Date().toISOString(), kind: 'delete', expenseId: row.expense_id })),
    { operationId: `legacy-settings-${seed}`, deviceId: 'legacy-client', queuedAt: new Date().toISOString(), kind: 'settings', settings: { budget: Number(state.budget), lastPayment: sanitizePayment(state.lastPayment) || { channel: '微信', method: '零钱' } } },
  ];
  for (const operation of operations) await applyOperation(owner, operation);
  return response(await syncResponse(owner, 0, operations.map((item) => item.operationId), true));
}
