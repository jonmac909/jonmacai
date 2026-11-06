// Charge watch (2026-11-05). MoneyClaw lists charges worth a look (a new subscription, an unusual
// one-off, a price rise on a kept one). Each becomes one question on the Questions page. Jon's answer
// goes back to MoneyClaw so the charge is never asked twice, and a "no" opens a follow-up card.
// Every step is safe to repeat: questions and cards are keyed, and a question closes only after its
// answer was saved in MoneyClaw.
const FEED = 'https://moneyclaw.jonmac.ai/api/internal/charge-watch';
const ACTION = 'https://moneyclaw.jonmac.ai/api/internal/dashboard-action';
const BOT = 'moneyclaw';
const PREFIX = 'cw:';
const MAX_FLAGS = 20; // a broken feed must not flood the Questions page

const newId = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
const cad = (minor) => `$${(Number(minor) / 100).toFixed(2)}`;

// "Keep" and "Expected" mean keep; "Cancel" and "Not expected" mean act; anything typed is Other.
export function answerKind(text) {
  const t = String(text || '').trim().toLowerCase();
  if (t === 'keep' || t === 'expected') return 'keep';
  if (t === 'cancel' || t === 'not expected') return 'cancel';
  return 'other';
}

// One question per merchant and kind at a time. The date (the newest charge) makes a later repeat of the
// same problem, such as a second charge after Cancel, a new question once the earlier one is closed.
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const keyStart = (flag) => `${PREFIX}${flag.key}:${flag.kind}:`;
export function questionKey(flag) {
  return `${keyStart(flag)}${flag.lastSeen}`;
}

function parseKey(idem) {
  const [, rest] = String(idem).split(PREFIX);
  const parts = String(rest || '').split(':');
  if (parts.length !== 3 || !DAY.test(parts[2])) return null;
  return { key: parts[0], kind: parts[1], version: parts[2] };
}

const LEADS = { price_rise: 'Price went up', one_off: 'Big one-off charge', after_cancel: 'Charged again after your answer' };

export function questionFor(flag) {
  const oneOff = flag.kind === 'one_off';
  const lead = LEADS[flag.kind] || 'New charge';
  return {
    question: `${lead}: ${flag.summary}. ${oneOff ? 'Was this expected?' : 'Keep it?'}`,
    options: oneOff ? ['Expected', 'Not expected'] : ['Keep', 'Cancel'],
    context: `MoneyClaw flagged this from ${flag.firstSeen} to ${flag.lastSeen} (${flag.count} charge${flag.count === 1 ? '' : 's'}). Your answer is saved, so it is not asked again unless the price rises.`,
  };
}

async function openQuestions(db, flags, now) {
  let added = 0;
  for (const flag of flags.slice(0, MAX_FLAGS)) {
    if (!flag?.key || !flag.kind || !DAY.test(String(flag.lastSeen)) || !/^\d+$/.test(String(flag.amountNativeMinor))) continue;
    const q = questionFor(flag);
    // Already asked and not finished (open, or answered but not yet saved): keep its text current, never ask twice.
    const start = keyStart(flag);
    const { results: active = [] } = await db.prepare(
      "SELECT id, question, status FROM bot_questions WHERE asked_by = ? AND status IN ('open', 'answered') AND substr(idem_key, 1, ?) = ?",
    ).bind(BOT, start.length, start).all();
    if (active.length) {
      for (const row of active) {
        if (row.status === 'open' && row.question !== q.question) {
          await db.prepare("UPDATE bot_questions SET question = ?, context = ?, updated_at = ? WHERE id = ? AND status = 'open'")
            .bind(q.question, q.context, now, row.id).run();
        }
      }
      continue;
    }
    const r = await db.prepare(
      `INSERT INTO bot_questions (id, asked_by, question, context, options, project, status, idem_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'accounting', 'open', ?, ?, ?) ON CONFLICT DO NOTHING`,
    ).bind(newId('q'), BOT, q.question, q.context, JSON.stringify(q.options), questionKey(flag), now, now).run();
    added += r?.meta?.changes || 0;
  }
  return added;
}

async function openCard(db, row, flag, parsed, now) {
  const merchant = flag?.merchant || parsed.key;
  const title = { one_off: `Check ${merchant} charge`, after_cancel: `${merchant} charged after cancel` }[parsed.kind] || `Cancel ${merchant}`;
  const next = {
    one_off: '- Find out why it was charged and dispute it if it is wrong.',
    after_cancel: '- Make sure the cancel went through, stop the billing and ask for a refund.',
  }[parsed.kind] || '- Cancel it with the company, then mark this done.';
  const note = ['What happened', `- You answered "${row.answer}" on ${merchant}${flag ? ` (${cad(flag.amountCadMinor)})` : ''}.`, 'Next', next].join('\n');
  await db.prepare(
    `INSERT INTO bot_tasks (id, title, owner, status, note, project, created_by, updated_by, idem_key, created_at, updated_at)
     VALUES (?, ?, ?, 'todo', ?, 'accounting', ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  ).bind(newId('t'), title.slice(0, 300), BOT, note, BOT, BOT, `cw-card:${parsed.key}:${parsed.kind}:${parsed.version}`, now, now).run();
}

async function sendAnswers(db, token, flags, fetchFn, now) {
  const { results = [] } = await db.prepare(
    "SELECT id, idem_key, answer FROM bot_questions WHERE asked_by = ? AND idem_key LIKE 'cw:%' AND status = 'answered' ORDER BY updated_at LIMIT 50",
  ).bind(BOT).all();
  let sent = 0;
  for (const row of results) {
    const parsed = parseKey(row.idem_key);
    if (!parsed) continue;
    const flag = flags.find((f) => f.key === parsed.key && f.kind === parsed.kind);
    const answer = answerKind(row.answer);
    const res = await fetchFn(ACTION, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'charge_watch_answer', key: parsed.key, answer,
        amountCadMinor: flag ? String(flag.amountCadMinor) : '', amountNativeMinor: flag ? String(flag.amountNativeMinor) : '', currency: flag?.currency || '',
        frequency: flag?.frequency || '', merchant: flag?.merchant || '', kind: parsed.kind,
      }),
    });
    // A server error stays answered and is retried. A 400 can never succeed, so it must not block the others.
    if (!res.ok && res.status !== 400) continue;
    // Even when MoneyClaw rejects the answer, a Cancel is still Jon's decision, so its card opens.
    if (answer === 'cancel') await openCard(db, row, flag, parsed, now);
    await db.prepare("UPDATE bot_questions SET status = 'closed', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status = 'answered'")
      .bind(BOT, now, now, row.id).run();
    if (res.ok) sent += 1;
  }
  return sent;
}

export async function syncChargeWatch(env, fetchFn = globalThis.fetch, now = new Date().toISOString()) {
  const token = env?.MONEYCLAW_DASHBOARD_TOKEN;
  if (!env?.DB || !token) return { asked: 0, answered: 0 };
  const res = await fetchFn(FEED, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`charge watch feed ${res.status}`);
  const body = await res.json();
  const flags = Array.isArray(body?.flags) ? body.flags : [];
  const asked = await openQuestions(env.DB, flags, now);
  const answered = await sendAnswers(env.DB, token, flags, fetchFn, now);
  return { asked, answered };
}
