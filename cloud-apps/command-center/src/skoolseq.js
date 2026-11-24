// The 7-day Skool email sequence: master switch, cron sender, unsubscribe, Resend webhook, test send. Copy is in skoolmail.js.
// Safety, all enforced here and covered by test/skool-seq.test.mjs:
//  - OFF by default: nothing is sent unless skool_settings.skool_sequence_on = '1'. Only Jon's signed-in click turns it on.
//  - Needs RESEND_API_KEY (Worker secret). Never printed or stored. Without it nothing is claimed or sent.
//  - Real sends wait until the mailing address is real (env.SKOOL_ADDRESS, not the [ADDRESS] placeholder).
//  - One row per email + day (skool_seq_sends primary key) is claimed before sending: no double sends, even with overlapping crons.
//  - A lead stops getting mail the moment they buy (their email is in skool_sales), unsubscribe, bounce or complain.
//  - Only leads the email check passed (valid or risky) are enrolled: a kept typo ("suggested") and leads captured before the check existed get nothing.
//  - Finished leads and leads given up on are left out of the query, so a long list never crowds out new leads.
//  - The test send goes to TEST_TO only.
import { hmacHex, timingSafeEqualString } from './auth.js';
import { renderEmail, SEQUENCE_DAYS } from './skoolmail.js';
import { SHORT_LINKS } from './skoolroutes.js';

export const TEST_TO = 'jon@thejonmac.com';
export const DEFAULT_FROM = 'Jon Mac <support@viralview.io>'; // the sender domain the clone app already uses on Resend; override with SKOOL_FROM
export const DEFAULT_REPLY_TO = 'jon@thejonmac.com';
export const DEFAULT_BUSINESS = 'Ecomm House Inc.'; // from rules/facts/people.md; override with SKOOL_BUSINESS
export const ADDRESS_PLACEHOLDER = '[ADDRESS]'; // Jon's mailing address is not in rules/facts; set the SKOOL_ADDRESS var
export const GAP_MS = 24 * 3600e3; // the next email goes out 24 hours after the last one
export const MAX_AGE_MS = 7 * 864e5; // a lead older than this when the sequence runs is not enrolled: day 0 says "you came over from my video"
export const MAX_PER_RUN = 8;
export const SEQ_CRON = '*/15 * * * *'; // must match wrangler.jsonc triggers.crons
const ORIGIN = 'https://jonmac.ai';
const iso = (ms) => new Date(ms).toISOString();
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

const sender = (env) => ({
  from: env.SKOOL_FROM || DEFAULT_FROM,
  replyTo: env.SKOOL_REPLY_TO || DEFAULT_REPLY_TO,
  business: env.SKOOL_BUSINESS || DEFAULT_BUSINESS,
  address: env.SKOOL_ADDRESS || ADDRESS_PLACEHOLDER,
  origin: env.SKOOL_ORIGIN || ORIGIN,
});
export const addressIsPlaceholder = (env) => !env.SKOOL_ADDRESS || env.SKOOL_ADDRESS.includes('[ADDRESS]');

// ---- switch ----
export async function seqOn(db) {
  try { return (await db.prepare("SELECT value FROM skool_settings WHERE key = 'skool_sequence_on'").first())?.value === '1'; } catch { return false; }
}
export async function setSeqOn(db, on, nowMs = Date.now()) {
  await db.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_sequence_on', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(on ? '1' : '0', iso(nowMs)).run();
}

// ---- unsubscribe ----
const unsubKey = (env) => env.SKOOL_UNSUB_SECRET || env.SESSION_SECRET || '';
export async function unsubToken(env, email) { return (await hmacHex(unsubKey(env), `skool-unsub:${email.toLowerCase()}`)).slice(0, 32); }
export async function unsubUrl(env, email) {
  return `${sender(env).origin}/track/unsub?e=${encodeURIComponent(email.toLowerCase())}&t=${await unsubToken(env, email)}`;
}
const page = (title, msg, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title}</title></head>
<body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;color:#1f1f1f"><h1 style="font-size:1.3rem">${title}</h1><p>${msg}</p></body></html>`,
{ status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });

// GET (the link in the email) and POST (mail apps' one-click, RFC 8058) both unsubscribe straight away.
export async function handleUnsub(request, env, nowMs = Date.now()) {
  const url = new URL(request.url);
  const email = (url.searchParams.get('e') || '').toLowerCase();
  const given = url.searchParams.get('t') || '';
  if (!email || !given || !unsubKey(env) || !timingSafeEqualString(given, await unsubToken(env, email))) return page('That link does not work', 'Please use the unsubscribe link from the newest email, or reply to it and ask to be removed.', 400);
  await env.DB.prepare("INSERT INTO skool_seq_stops (email, reason, at) VALUES (?, 'unsubscribed', ?) ON CONFLICT(email) DO NOTHING").bind(email, iso(nowMs)).run();
  return page("You're unsubscribed", 'No more emails from this list. Sorry to see you go.');
}

// ---- Resend ----
export async function resendSend(env, msg, fetchImpl = fetch, idempotencyKey = '') {
  if (!env.RESEND_API_KEY) return { ok: false, error: 'no-key' };
  try {
    const r = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
      body: JSON.stringify(msg),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.id) return { ok: true, id: j.id };
    return { ok: false, error: `resend ${r.status}: ${String(j.message || j.name || '').slice(0, 160)}` };
  } catch (err) { return { ok: false, error: `network: ${String(err?.message || err).slice(0, 100)}` }; }
}

async function message(env, email, day, title, slug, subjectPrefix = '') {
  const s = sender(env);
  const un = await unsubUrl(env, email);
  const mail = renderEmail(day, { title, slug, unsubUrl: un, business: s.business, address: s.address });
  return {
    from: s.from, to: [email], reply_to: s.replyTo, subject: subjectPrefix + mail.subject, html: mail.html, text: mail.text,
    headers: { 'List-Unsubscribe': `<${un}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{ name: 'sequence', value: 'skool' }, { name: 'day', value: String(day) }],
  };
}

// ---- the cron job (every 15 minutes) ----
// Returns what it did so tests and logs can see it; never throws.
export async function runSequence(env, nowMs = Date.now(), fetchImpl = fetch) {
  const out = { sent: 0, failed: 0, skipped: '' };
  try {
    if (!env?.DB || !(await seqOn(env.DB))) { out.skipped = 'off'; return out; }
    if (!env.RESEND_API_KEY) { out.skipped = 'no-key'; return out; }
    if (addressIsPlaceholder(env)) { out.skipped = 'no-address'; return out; }
    const rows = (await env.DB.prepare(`SELECT l.email AS email, MIN(l.at) AS first_at FROM skool_leads l
      WHERE NOT EXISTS (SELECT 1 FROM skool_seq_stops s WHERE s.email = l.email)
        AND NOT EXISTS (SELECT 1 FROM skool_sales b WHERE b.email = l.email)
        AND l.email_check IN ('valid', 'risky')
        AND (SELECT COUNT(*) FROM skool_seq_sends q WHERE q.email = l.email AND q.status IN ('sent', 'sending')) < ${SEQUENCE_DAYS}
        AND NOT EXISTS (SELECT 1 FROM skool_seq_sends q WHERE q.email = l.email AND q.status = 'failed' AND q.attempts >= 3)
      GROUP BY l.email HAVING MIN(l.at) >= ? ORDER BY MIN(l.at) LIMIT 2000`).bind(iso(nowMs - MAX_AGE_MS)).all()).results || [];
    if (!rows.length) return out;
    const sends = new Map(); // email -> day -> row
    for (const r of (await env.DB.prepare('SELECT email, day, status, attempts, sent_at FROM skool_seq_sends').all()).results || []) {
      if (!sends.has(r.email)) sends.set(r.email, new Map());
      sends.get(r.email).set(r.day, r);
    }
    for (const lead of rows) {
      if (out.sent + out.failed >= MAX_PER_RUN) break;
      const mine = sends.get(lead.email) || new Map();
      let day = 0;
      while (day < SEQUENCE_DAYS && ['sent', 'sending'].includes(mine.get(day)?.status)) day++;
      if (day >= SEQUENCE_DAYS) continue; // finished
      const row = mine.get(day);
      if (row?.status === 'failed' && row.attempts >= 3) continue; // gave up on this one
      if (day > 0) {
        const prev = mine.get(day - 1);
        if (prev?.status !== 'sent' || !prev.sent_at || Date.parse(prev.sent_at) + GAP_MS > nowMs) continue; // not due yet (or the last one's outcome is unknown)
      } else if (Date.parse(lead.first_at) > nowMs) continue;
      const first = await env.DB.prepare('SELECT l.slug AS slug, k.title AS title FROM skool_leads l LEFT JOIN skool_links k ON k.slug = l.slug WHERE l.email = ? ORDER BY l.at LIMIT 1').bind(lead.email).first();
      // Claim the day. Only one winner: a second cron run or a retry finds the row and does nothing.
      const claim = row
        ? await env.DB.prepare("UPDATE skool_seq_sends SET status = 'sending', attempts = attempts + 1, error = NULL WHERE email = ? AND day = ? AND status = 'failed' AND attempts < 3").bind(lead.email, day).run()
        : await env.DB.prepare("INSERT OR IGNORE INTO skool_seq_sends (email, day, slug, status, attempts) VALUES (?, ?, ?, 'sending', 1)").bind(lead.email, day, first?.slug || null).run();
      if (!claim.meta?.changes) continue;
      // Last look before sending: a sale or stop that landed since the list was read.
      const blocked = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM skool_sales WHERE email = ?1) + (SELECT COUNT(*) FROM skool_seq_stops WHERE email = ?1) AS n').bind(lead.email).first();
      if (blocked?.n) { await env.DB.prepare('DELETE FROM skool_seq_sends WHERE email = ? AND day = ? AND status = ?').bind(lead.email, day, 'sending').run(); continue; }
      const res = await resendSend(env, await message(env, lead.email, day, first?.title || (Object.hasOwn(SHORT_LINKS, first?.slug || '') ? SHORT_LINKS[first.slug].title : ''), first?.slug || ''), fetchImpl, `skool-seq/${lead.email}/${day}`);
      if (res.ok) {
        await env.DB.prepare("UPDATE skool_seq_sends SET status = 'sent', resend_id = ?, sent_at = ? WHERE email = ? AND day = ?").bind(res.id, iso(nowMs), lead.email, day).run();
        out.sent++;
      } else {
        await env.DB.prepare("UPDATE skool_seq_sends SET status = 'failed', error = ? WHERE email = ? AND day = ?").bind(res.error, lead.email, day).run();
        out.failed++;
        console.error('skool sequence send failed', day, res.error); // no email, no key
      }
    }
  } catch (err) { console.error('skool sequence', err?.message || err); out.skipped = 'error'; }
  return out;
}

// ---- test send: all seven, to TEST_TO only ----
export async function sendTest(env, nowMs = Date.now(), fetchImpl = fetch, pauseMs = 700) {
  if (!env.RESEND_API_KEY) return { status: 503, body: { error: 'Blocked: Resend key. The Worker has no RESEND_API_KEY secret yet.' } };
  const last = await env.DB.prepare("SELECT value FROM skool_settings WHERE key = 'skool_seq_test_at'").first();
  if (last && nowMs - Date.parse(last.value) < 120e3) return { status: 429, body: { error: 'A test went out less than 2 minutes ago. Check your inbox.' } };
  await env.DB.prepare("INSERT INTO skool_settings (key, value, updated_at) VALUES ('skool_seq_test_at', ?1, ?1) ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?1").bind(iso(nowMs)).run();
  const link = await env.DB.prepare('SELECT slug, title FROM skool_links ORDER BY created_at DESC LIMIT 1').first();
  const results = [];
  for (let day = 0; day < SEQUENCE_DAYS; day++) {
    if (day && pauseMs) await new Promise((r) => setTimeout(r, pauseMs)); // Resend allows 2 calls a second
    const res = await resendSend(env, await message(env, TEST_TO, day, link?.title || 'Your video title', link?.slug || 'test', `[TEST day ${day} of ${SEQUENCE_DAYS - 1}] `), fetchImpl);
    results.push({ day, ok: res.ok, id: res.ok ? res.id : undefined, error: res.ok ? undefined : res.error });
  }
  return { status: results.every((r) => r.ok) ? 200 : 502, body: { to: TEST_TO, results, note: addressIsPlaceholder(env) ? 'The mailing address is still the [ADDRESS] placeholder.' : undefined } };
}

// ---- Resend webhook (Svix-signed) ----
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function verifySvix(secret, headers, raw, nowMs = Date.now()) {
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sig = headers.get('svix-signature');
  if (!secret || !id || !ts || !sig || !Number.isFinite(Number(ts)) || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  let key;
  try { key = await crypto.subtle.importKey('raw', unb64(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); } catch { return false; }
  const expect = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  return sig.split(' ').some((p) => { const [v, s] = p.split(','); return v === 'v1' && s && timingSafeEqualString(s, expect); });
}

// Only mail from this sequence is acted on (the Resend account also sends other apps' mail): the event's email id must be one of ours.
export async function handleResendWebhook(request, env, nowMs = Date.now()) {
  if (!env.RESEND_WEBHOOK_SECRET) return new Response(JSON.stringify({ error: 'Webhook secret not set' }), { status: 503, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
  const raw = await request.text();
  if (!(await verifySvix(env.RESEND_WEBHOOK_SECRET, request.headers, raw, nowMs))) return new Response(JSON.stringify({ error: 'Bad signature' }), { status: 401, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
  let ev = {};
  try { ev = JSON.parse(raw); } catch { /* ignore */ }
  const id = ev?.data?.email_id;
  if (id && typeof ev.type === 'string') {
    const mine = await env.DB.prepare('SELECT email FROM skool_seq_sends WHERE resend_id = ?').bind(String(id)).first();
    if (mine) {
      if (ev.type === 'email.opened') await env.DB.prepare('UPDATE skool_seq_sends SET opened_at = COALESCE(opened_at, ?) WHERE resend_id = ?').bind(iso(nowMs), String(id)).run();
      else if (ev.type === 'email.complained') await env.DB.prepare("INSERT INTO skool_seq_stops (email, reason, at) VALUES (?, 'complained', ?) ON CONFLICT(email) DO NOTHING").bind(mine.email, iso(nowMs)).run();
      else if (ev.type === 'email.bounced' && String(ev.data?.bounce?.type || '').toLowerCase() !== 'transient') await env.DB.prepare("INSERT INTO skool_seq_stops (email, reason, at) VALUES (?, 'bounced', ?) ON CONFLICT(email) DO NOTHING").bind(mine.email, iso(nowMs)).run();
    }
  }
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...NO_STORE } });
}
