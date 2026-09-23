import { completeAction, listSnapshots, upsertSnapshot } from './db.js';
import {
  CONNECTOR, GROUP_NAME, ORIGIN, PAGE_LIMIT,
  mergeWindow, messageFromUpdate, rankIdeas, takePages, unavailable,
} from './mastermind-source.js';

const ALLOWED = new Set(['getChat', 'getUpdates']);
const SOURCE = 'mastermind_group';

function safe(text, token) {
  return String(text || 'source failed').split(token).join('[token]');
}

async function tg(fetchFn, token, method, body) {
  if (!ALLOWED.has(method)) throw new Error(`refusing ${method}`);
  const res = await fetchFn(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    const err = new Error(safe(data.description || `HTTP ${res.status}`, token));
    err.status = res.status;
    throw err;
  }
  return data.result;
}

export async function readGroup(env, opts = {}) {
  const nowMs = opts.nowMs || Date.now();
  const token = env.TELEGRAM_GROUP_BOT_TOKEN;
  const chatId = env.TELEGRAM_GROUP_CHAT_ID;
  if (!token || !chatId) return unavailable(CONNECTOR, nowMs);
  if (env.TELEGRAM_BOT_TOKEN && token === env.TELEGRAM_BOT_TOKEN) {
    return unavailable(`Refusing to read updates on the DM bridge bot. ${CONNECTOR}`, nowMs);
  }
  const fetchFn = opts.fetchFn || globalThis.fetch;
  try {
    const chat = await tg(fetchFn, token, 'getChat', { chat_id: chatId });
    const seen = chat?.id == null ? '' : String(chat.id);
    if (seen !== String(chatId)) return unavailable(`Chat is not the allowed mirror. ${CONNECTOR}`, nowMs);
    if (env.TELEGRAM_CHAT_ID && String(chatId) === String(env.TELEGRAM_CHAT_ID)) {
      return unavailable(`Refusing the personal DM chat. ${CONNECTOR}`, nowMs);
    }
    const title = String(chat?.title || '');
    let offset = Number(opts.offset) || 0;
    const pages = [];
    // ponytail: next getUpdates confirms the previous page; a crash between pages drops that page. Persist each page first if a missed page matters.
    for (let i = 0; i < 10; i++) {
      const batch = await tg(fetchFn, token, 'getUpdates', {
        offset: offset || undefined,
        limit: PAGE_LIMIT,
        timeout: 0,
        allowed_updates: ['channel_post'],
      });
      const list = Array.isArray(batch) ? batch : [];
      pages.push(list);
      if (list.length < PAGE_LIMIT) break;
      const next = Number(list[list.length - 1]?.update_id) + 1;
      if (!Number.isFinite(next) || next === offset) break;
      offset = next;
    }
    const updates = takePages(pages);
    const incoming = updates.map((u) => messageFromUpdate(u, chatId)).filter(Boolean);
    const messages = mergeWindow(opts.prior, incoming, nowMs);
    const last = updates.length ? Number(updates[updates.length - 1].update_id) + 1 : Number(opts.offset) || 0;
    return {
      origin: ORIGIN,
      access: 'ok',
      sourceForwarding: false,
      scanned: messages.length,
      picks: rankIdeas(messages),
      messages,
      offset: Number.isFinite(last) ? last : 0,
      scannedAt: new Date(nowMs).toISOString(),
      empty: messages.length === 0,
      history: 'bot-updates',
      chatTitle: title,
    };
  } catch (err) {
    return unavailable(safe(err.message, token), nowMs);
  }
}

function priorOf(rows) {
  const row = (rows || []).find((r) => r.source === SOURCE);
  if (!row) return { messages: [], offset: 0 };
  try {
    const data = JSON.parse(row.data);
    return { messages: data.messages || [], offset: Number(data.offset) || 0 };
  } catch {
    return { messages: [], offset: 0 };
  }
}

export async function syncGroup(env, opts = {}) {
  const prior = priorOf(await listSnapshots(env.DB));
  const data = await readGroup(env, { ...opts, prior: prior.messages, offset: prior.offset });
  const now = new Date().toISOString();
  await upsertSnapshot(env.DB, SOURCE, JSON.stringify(data), data.scannedAt, now);
  return data;
}

export async function finishMastermindScan(env, id, opts = {}) {
  const now = new Date().toISOString();
  try {
    const data = await syncGroup(env, opts);
    const status = data.access === 'ok' ? 'done' : 'failed';
    const result = JSON.stringify({
      access: data.access,
      error: data.error,
      connector: data.access === 'ok' ? undefined : data.connector,
      scanned: data.scanned,
      picks: data.picks.length,
      empty: data.empty,
      scannedAt: data.scannedAt,
    });
    await completeAction(env.DB, id, status, result, now);
  } catch (err) {
    const fail = unavailable(err.message || 'Scan failed', Date.now());
    await upsertSnapshot(env.DB, SOURCE, JSON.stringify(fail), fail.scannedAt, now);
    await completeAction(env.DB, id, 'failed', JSON.stringify({
      access: 'unavailable', error: fail.error, connector: CONNECTOR, scanned: 0, picks: 0, empty: false, scannedAt: fail.scannedAt,
    }), now);
  }
}
