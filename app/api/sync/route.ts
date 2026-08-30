import { env } from 'cloudflare:workers';
import { createUserStateTable } from '@/db/schema';

export const dynamic = 'force-dynamic';

type CloudState = {
  version: 1;
  budget: number;
  expenses: unknown[];
  lastPayment?: { channel: '微信' | '支付宝'; method: string };
};

function database() {
  return (env as unknown as { DB: D1Database }).DB;
}

function userId(request: Request) {
  const authenticated = request.headers.get('oai-authenticated-user-id');
  if (authenticated) return authenticated;
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' ? 'local-preview-user' : null;
}

async function initialize() {
  await database().prepare(createUserStateTable).run();
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(request: Request) {
  const owner = userId(request);
  if (!owner) return response({ error: '请先登录后同步' }, 401);
  await initialize();
  const record = await database().prepare('SELECT payload, revision, updated_at FROM user_state WHERE user_id = ?').bind(owner).first<{ payload: string; revision: number; updated_at: string }>();
  if (!record) return response({ state: null, revision: 0, updatedAt: null });
  return response({ state: JSON.parse(record.payload) as CloudState, revision: record.revision, updatedAt: record.updated_at });
}

export async function PUT(request: Request) {
  const owner = userId(request);
  if (!owner) return response({ error: '请先登录后同步' }, 401);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return response({ error: '请求来源无效' }, 403);

  const state = await request.json() as CloudState;
  if (state.version !== 1 || !Array.isArray(state.expenses) || !Number.isFinite(state.budget)) return response({ error: '账本数据格式无效' }, 400);
  const payload = JSON.stringify(state);
  if (payload.length > 4_000_000) return response({ error: '账本数据过大，请先导出并精简记录' }, 413);

  await initialize();
  const updatedAt = new Date().toISOString();
  await database().prepare(`
    INSERT INTO user_state (user_id, payload, revision, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      payload = excluded.payload,
      revision = user_state.revision + 1,
      updated_at = excluded.updated_at
  `).bind(owner, payload, updatedAt).run();
  const saved = await database().prepare('SELECT revision FROM user_state WHERE user_id = ?').bind(owner).first<{ revision: number }>();
  return response({ revision: saved?.revision || 1, updatedAt });
}
