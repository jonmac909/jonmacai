// Skool tracker (Jon, 2026-11-16): one short link per YouTube video, jonmac.ai/<slug> (Jon 2026-11-21: no /s/; old /s/ links still work), that counts the click and
// forwards to the Skool group. Paid members come in from Jon's Zapier zaps; /track shows clicks and sales per video.
// Skool has no API or webhooks: Zapier's "New Paid Member" and "Answered Membership Questions" triggers POST here
// with the SKOOL_ZAP_TOKEN secret. Attribution of a sale, best first: the buyer's email was captured on a link (the
// optional email step, off by default, switched per link on /track), else the member's answer names a video, else
// an estimate: the last click in the 24 hours before it.
import { readSession, timingSafeEqualString } from './auth.js';
import { checkEmail } from './skoolcheck.js';
import { handleUnsub, handleResendWebhook, seqOn, setSeqOn, sendTest, addressIsPlaceholder, DEFAULT_BUSINESS } from './skoolseq.js';
import { leadsData, leadsCsv, leadsPage, emailsPage, nav, BASE_CSS, FILTERS } from './skoolcrm.js';
import { SLUG_RE, SHORT_LINKS, SHORT_VARIANTS, listRoutes, slugRefusal, ensureSlugRoute } from './skoolroutes.js';

export const SKOOL = 'https://www.skool.com/ai-ugc';
export const ESTIMATE_HOURS = 24;
const YT_RE = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const MAX_LEADS_PER_10_MIN = 60; // per link: stops a script from filling the table
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const iso = (ms) => new Date(ms).toISOString();
const forward = (to) => new Response(null, { status: 302, headers: { Location: to.href, ...NO_STORE } });

// GET /s/<slug>: forwards, so a viewer never hits a dead end; only known slugs and real GETs are counted.
// UTM tags ride along (Skool keeps them on its /about page; checked 2026-11-16). Never ?ref=: that is Skool's affiliate tag.
// A link with the email step on (skool_links.capture = 1) shows a one-field page first; its POST stores the email and forwards.
// Social bio links (Jon 2026-11-24): jonmac.ai/<short> always shows the email lander; the slug is the platform's record
// (clicks and leads are stored under it) and Skool gets utm_source=<platform>&utm_medium=social&utm_campaign=bio.
export const SOCIAL = { ig: 'instagram', tt: 'tiktok', x: 'x', fb: 'facebook', li: 'linkedin', youtube: 'youtube' };
// Old /s/ social links: 301 to the short link, query string kept. /yt is another app, so /s/yt goes to /youtube.
const OLD_SOCIAL = { ig: 'ig', tt: 'tt', x: 'x', fb: 'fb', li: 'li', yt: 'youtube' };
const isSocial = (slug) => Object.hasOwn(SOCIAL, slug);
// One-word video links (src/skoolroutes.js SHORT_LINKS), e.g. jonmac.ai/neon: a video link with no skool_links row.
export const isShort = (slug) => Object.hasOwn(SHORT_VARIANTS, slug); // every platform variant: neon, neonx, neonli, ...
export const isBuiltIn = (slug) => isSocial(slug) || isShort(slug);

export async function skoolRedirect(request, env, ctx) {
  const url = new URL(request.url);
  const old = url.pathname.startsWith('/s/');
  const raw = url.pathname.slice(old ? 3 : 1).toLowerCase();
  const slug = !old && isBuiltIn(raw.replace(/\/$/, '')) ? raw.replace(/\/$/, '') : raw; // /ig/ is /ig, /neon/ is /neon
  if (old && BG.has(slug)) return backdrop(request, env, slug); // the pop-over's screenshot backdrop (a slug has no dot, so no clash)
  if (old && Object.hasOwn(OLD_SOCIAL, slug)) return new Response(null, { status: 301, headers: { Location: `/${OLD_SOCIAL[slug]}${url.search}`, ...NO_STORE } });
  if (old && isShort(slug)) return new Response(null, { status: 301, headers: { Location: `/${slug}${url.search}`, ...NO_STORE } }); // /s/neon is /neon
  const social = !old && isSocial(slug);
  const short = !old && isShort(slug);
  const to = new URL(SKOOL);
  if (!(social || SLUG_RE.test(slug)) || !['GET', 'HEAD', 'POST'].includes(request.method)) return forward(to);
  to.searchParams.set('utm_source', social ? SOCIAL[slug] : short ? SHORT_VARIANTS[slug].platform : 'youtube');
  to.searchParams.set('utm_medium', social ? 'social' : 'video');
  to.searchParams.set('utm_campaign', social ? 'bio' : short ? SHORT_VARIANTS[slug].word : slug);
  if (!env.DB) return forward(to);
  let link = null;
  if (social || short) link = { capture: 1 }; // no skool_links row needed: always the lander (a /track video link's default)
  else try { link = await env.DB.prepare('SELECT capture FROM skool_links WHERE slug = ?').bind(slug).first(); } catch (err) {
    console.error('skool link', err); // e.g. the capture column is missing before migration 0030: keep counting clicks, no email step
    try { link = await env.DB.prepare('SELECT slug FROM skool_links WHERE slug = ?').bind(slug).first(); } catch { /* unknown */ }
  }
  if (!link) return forward(to); // unknown slug: forward, count nothing
  const capture = link.capture === 1;
  if (request.method === 'POST') {
    if (!capture) return forward(to);
    const b = await body(request);
    const pick = field(b, 'pick'); // 'fix' = take the "Did you mean" address, 'keep' = keep what was typed
    const typed = field(b, 'email').toLowerCase();
    const email = pick === 'fix' && field(b, 'suggest') ? field(b, 'suggest').toLowerCase() : typed;
    const res = await checkEmail(email, { keepTypo: pick === 'keep' });
    if (!res.ok) {
      return capturePage(slug, res.message, 400, res.reason === 'typo' ? { typed: email, suggestion: res.suggestion } : { typed: res.reason === 'syntax' ? typed.slice(0, 254) : email });
    }
    // Never log the email: a failure prints the slug only.
    try {
      const now = Date.now();
      const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM skool_leads WHERE slug = ? AND at >= ?').bind(slug, iso(now - 600e3)).first();
      if ((recent?.n || 0) < MAX_LEADS_PER_10_MIN) {
        // at = the first capture time (a later visit must not move it past an earlier sale); last_at and the check follow the newest visit.
        await env.DB.prepare(`INSERT INTO skool_leads (slug, email, at, email_check, last_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(slug, email) DO UPDATE SET last_at = excluded.last_at, email_check = excluded.email_check`)
          .bind(slug, res.email, iso(now), res.check, iso(now)).run();
      }
    } catch { console.error('skool lead save failed', slug); }
    return forward(to);
  }
  if (request.method === 'GET' && !url.searchParams.has('qc')) {
    let ref = null;
    try { const r = new URL(request.headers.get('Referer') || ''); ref = (r.host + r.pathname).slice(0, 200); } catch { /* none */ }
    const country = typeof request.cf?.country === 'string' ? request.cf.country.slice(0, 2) : null;
    ctx.waitUntil(env.DB.prepare('INSERT INTO skool_clicks (slug, at, referrer, country) VALUES (?, ?, ?, ?)')
      .bind(slug, iso(Date.now()), ref, country).run().catch((err) => console.error('skool click', err)));
  }
  return capture ? capturePage(slug, '', 200) : forward(to);
}

// The email step looks like the Skool about page with the email box as a pop-over. www.skool.com sends
// X-Frame-Options: SAMEORIGIN (checked 2026-11-16), so it cannot be framed: the backdrop is a screenshot of
// skool.com/ai-ugc/about (public/skool/about-*.jpg, refreshed by hand with web_look.py --shot), blurred and dimmed.
const BG = new Set(['about-desktop.jpg', 'about-mobile.jpg']);
async function backdrop(request, env, name) {
  if (!env.ASSETS || request.method === 'POST' || !BG.has(name)) return new Response('Not found', { status: 404 });
  const u = new URL(request.url);
  u.pathname = `/skool/${name}`; u.search = '';
  const r = await env.ASSETS.fetch(new Request(u, { method: 'GET' }));
  if (!r.ok) return new Response('Not found', { status: 404 });
  return new Response(r.body, { status: 200, headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'X-Robots-Tag': 'noindex, nofollow' } });
}

function capturePage(slug, error, status, { typed = '', suggestion = '' } = {}) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>AI Video Lab on Skool</title><style>
html,body{height:100%;margin:0}body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1f1f1f;background:#f5f5f5;overflow:hidden}
.bg{position:fixed;inset:-12px;background:#f5f5f5 url(/s/about-desktop.jpg) center top/cover no-repeat;filter:blur(5px)}
@media (max-width:640px){.bg{background-image:url(/s/about-mobile.jpg)}}
.dim{position:fixed;inset:0;background:rgba(0,0,0,.45)}
.wrap{position:fixed;inset:0;display:flex;overflow:auto;padding:1rem;box-sizing:border-box}
.box{margin:auto;box-sizing:border-box;width:min(26rem,100%);background:#fff;border-radius:12px;padding:1.75rem 1.5rem 1.25rem;box-shadow:0 12px 48px rgba(0,0,0,.35)}
h1{font-size:1.3rem;margin:0 0 1rem;line-height:1.3}form{display:grid;gap:.75rem}
input{font:inherit;padding:.75rem .9rem;border-radius:8px;border:1px solid #c9c9c9;background:#fff;color:#1f1f1f}
input:focus{outline:2px solid #f8d481;outline-offset:1px;border-color:#b58a1c}
button{font:inherit;font-weight:700;cursor:pointer;border:0;border-radius:8px;padding:.8rem 1rem;background:#f8d481;color:#202124}
button:hover{background:#f5c961}button.alt{background:#eee;font-weight:500}button.alt:hover{background:#e3e3e3}.err{color:#b3261e;margin:0 0 .75rem}.note{color:#6b6b6b;font-size:.85rem;margin:1rem 0 0}</style></head><body>
<div class="bg" aria-hidden="true"></div><div class="dim" aria-hidden="true"></div>
<div class="wrap"><main class="box" role="dialog" aria-modal="true" aria-labelledby="t">
<h1 id="t">Enter your email to get access</h1>${error ? `<p class="err" role="alert">${esc(error)}</p>` : ''}
<form method="post" action="/${esc(slug)}"><input type="email" name="email" placeholder="you@example.com" autocomplete="email" aria-label="Email" required autofocus maxlength="254" value="${esc(typed)}">
${suggestion ? `<input type="hidden" name="suggest" value="${esc(suggestion)}"><button type="submit" name="pick" value="fix">Yes, use ${esc(suggestion)}</button><button type="submit" name="pick" value="keep" class="alt">No, keep what I typed</button>` : '<button type="submit">Continue</button>'}</form></main></div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE } });
}

async function body(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) return (await request.json().catch(() => null)) || {};
  if (type.includes('form')) return Object.fromEntries(await request.formData().catch(() => new FormData()));
  return {};
}
const field = (b, ...names) => { for (const n of names) if (b[n] != null && String(b[n]).trim()) return String(b[n]).trim(); return ''; };
function when(s, nowMs) {
  const t = s ? Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59Z` : s) : NaN; // a bare date means the end of that day
  return iso(Number.isFinite(t) && t <= nowMs + 3600e3 ? t : nowMs);
}

// POST /track/api/sale and /track/api/answer from Zapier. Token in the X-Track-Token header only.
async function zapIntake(request, env, kind, nowMs) {
  const given = request.headers.get('X-Track-Token') || ''; // header only: a token in the URL ends up in logs
  if (!env.SKOOL_ZAP_TOKEN || !given || !timingSafeEqualString(given, env.SKOOL_ZAP_TOKEN)) return json({ error: 'Bad token' }, 401);
  const b = await body(request);
  const email = field(b, 'email', 'subscription_email', 'Email').toLowerCase().slice(0, 200);
  const at = when(field(b, 'date', 'created_at', 'Date'), nowMs);
  if (kind === 'answer') {
    const answer = field(b, 'answer', 'answers', 'Answer').slice(0, 500);
    if (!email || !answer) return json({ error: 'email and answer are required' }, 400);
    await env.DB.prepare('INSERT INTO skool_answers (email, answer, at) VALUES (?, ?, ?) ON CONFLICT(email) DO UPDATE SET answer = excluded.answer, at = excluded.at')
      .bind(email, answer, at).run();
    return json({ ok: true });
  }
  const name = [field(b, 'first_name', 'First Name'), field(b, 'last_name', 'Last Name')].filter(Boolean).join(' ') || field(b, 'name');
  const id = (field(b, 'transaction_id', 'id', 'Transaction ID') || (email && `${email}|${at.slice(0, 10)}`)).slice(0, 200);
  if (!id) return json({ error: 'transaction_id or email is required' }, 400);
  const amt = Number(String(field(b, 'amount', 'price', 'Amount')).replace(/[^0-9.]/g, ''));
  await env.DB.prepare('INSERT OR IGNORE INTO skool_sales (id, email, name, at, created_at, amount) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, email || null, name.slice(0, 120) || null, at, iso(nowMs), Number.isFinite(amt) && amt > 0 && amt < 1e6 ? amt : null).run();
  return json({ ok: true, id });
}

// The link an answer names: its slug, its YouTube video ID, or its title.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function matchAnswer(answer, links) {
  const a = norm(answer);
  if (!a) return null;
  const raw = String(answer).toLowerCase();
  for (const l of links) {
    const id = YT_RE.exec(l.youtube_url || '')?.[4];
    if (new RegExp(`(/s|jonmac\\.ai)/${l.slug}(?![a-z0-9-])`).test(raw) || (id && String(answer).includes(id)) || (l.slug.length >= 6 && !isSocial(l.slug) && ` ${a} `.includes(` ${norm(l.slug)} `))) return l.slug; // short slugs like "ai" match too much
  }
  for (const l of links) {
    const t = norm(l.title);
    if (t && (a.includes(t) || (a.length >= 12 && t.includes(a)))) return l.slug;
  }
  return null;
}

// "Reset stats" (Jon, 2026-11-17): nothing is deleted. The time of the latest reset is one row in skool_settings; /track counts
// only clicks, leads and sales at or after it. Undo deletes the row, so every past count comes back. /track/leads is not
// filtered: it lists every lead ever captured and has no counters of its own that the reset touches.
const RESET_KEY = 'skool_stats_reset_at';
export async function statsResetAt(db) {
  try {
    const v = (await db.prepare('SELECT value FROM skool_settings WHERE key = ?').bind(RESET_KEY).first())?.value;
    return v && Number.isFinite(Date.parse(v)) ? v : null;
  } catch { return null; } // skool_settings missing (before migration 0031): no reset
}

export async function trackerData(db, nowMs = Date.now()) {
  const d7 = iso(nowMs - 7 * 864e5), d30 = iso(nowMs - 30 * 864e5);
  const since = await statsResetAt(db), from = since || ''; // ISO strings sort as text; '' is before everything
  const [links, clicks, sales, answers, leads] = await Promise.all([
    db.prepare('SELECT slug, title, youtube_url, created_at, capture FROM skool_links ORDER BY created_at DESC').all(),
    db.prepare(`SELECT slug, COUNT(*) AS total, SUM(at >= ?) AS d7, SUM(at >= ?) AS d30 FROM skool_clicks WHERE at >= ? GROUP BY slug`).bind(d7, d30, from).all(),
    db.prepare('SELECT id, email, name, at FROM skool_sales WHERE at >= ? ORDER BY at DESC LIMIT 2000').bind(from).all(),
    db.prepare('SELECT email, answer FROM skool_answers').all(),
    db.prepare('SELECT slug, email, at FROM skool_leads ORDER BY at DESC LIMIT 50000').all(),
  ]);
  const L = links.results || [];
  // The six social bio links count even without a skool_links row; last, so a video link's answer match wins first.
  for (const [slug, platform] of Object.entries(SOCIAL)) {
    if (!L.some((l) => l.slug === slug)) L.push({ slug, title: `${platform} bio link`, youtube_url: null, created_at: '', capture: 1 });
  }
  // The one-word video links count the same way, one row per platform variant (neon, neonx, ...), under its own slug.
  for (const [slug, s] of Object.entries(SHORT_VARIANTS)) {
    if (!L.some((l) => l.slug === slug)) L.push({ slug, title: s.title, youtube_url: SHORT_LINKS[s.word].youtube_url || null, created_at: '', capture: 1 });
  }
  const known = new Set(L.map((l) => l.slug));
  const C = new Map((clicks.results || []).map((c) => [c.slug, c]));
  const A = new Map((answers.results || []).map((x) => [x.email, x.answer]));
  const byEmail = new Map(); // email -> its leads, newest first
  const captured = new Map(); // slug -> emails captured
  for (const x of leads.results || []) {
    if (!known.has(x.slug)) continue;
    if (x.at >= from) captured.set(x.slug, (captured.get(x.slug) || 0) + 1); // every lead still matches its sale; only the count is cut
    if (!byEmail.has(x.email)) byEmail.set(x.email, []);
    byEmail.get(x.email).push(x);
  }
  // The clicks any estimate could use, read once (newest first): from 24 h before the oldest sale to the newest sale.
  const S = sales.results || [];
  const win = S.length ? (await db.prepare('SELECT slug, at FROM skool_clicks WHERE at >= ? AND at <= ? ORDER BY at DESC LIMIT 50000')
    .bind(iso(Date.parse(S[S.length - 1].at) - ESTIMATE_HOURS * 3600e3), S[0].at).all()).results || [] : [];
  const list = S.map((s) => {
    const answer = s.email ? A.get(s.email) ?? null : null;
    const lead = s.email ? (byEmail.get(s.email) || []).find((x) => x.at <= s.at) : null; // newest email captured before the sale
    let slug = lead ? lead.slug : answer ? matchAnswer(answer, L) : null;
    let how = lead ? 'email' : slug ? 'answer' : 'none';
    if (!slug) {
      const from = iso(Date.parse(s.at) - ESTIMATE_HOURS * 3600e3);
      const last = win.find((c) => c.at <= s.at && c.at >= from);
      if (last) { slug = last.slug; how = 'estimate'; }
    }
    return { at: s.at, name: s.name, slug, how, answer };
  });
  const rows = L.map((l) => {
    const c = C.get(l.slug) || {};
    const mine = list.filter((x) => x.slug === l.slug);
    const sure = mine.filter((x) => x.how === 'email' || x.how === 'answer').length, est = mine.length - sure;
    return { ...l, capture: l.capture === 1, emails: captured.get(l.slug) || 0, clicks: { d7: c.d7 || 0, d30: c.d30 || 0, all: c.total || 0 },
      sales: sure, estimated: est, conversion: c.total ? (sure + est) / c.total : null };
  });
  return { rows, sales: list, unattributed: list.filter((x) => !x.slug).length, since };
}

async function addLink(request, env, nowMs) {
  if (request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
  const b = await body(request);
  const slug = field(b, 'slug').toLowerCase(), title = field(b, 'title').slice(0, 200), yt = field(b, 'youtube_url');
  if (!SLUG_RE.test(slug)) return json({ error: 'Slug: 2 to 40 lower-case letters, numbers or dashes' }, 400);
  if (!title) return json({ error: 'Title is required' }, 400);
  if (yt && !YT_RE.test(yt)) return json({ error: 'YouTube URL must be a youtube.com or youtu.be video link' }, 400);
  if (await env.DB.prepare('SELECT 1 FROM skool_links WHERE slug = ?').bind(slug).first()) return json({ error: 'That slug is taken' }, 409);
  // Root links need their own route (src/skoolroutes.js): refuse dashboard paths, other apps' routes and real site pages.
  const routes = await listRoutes(env);
  const why = await slugRefusal(env, slug, routes);
  if (why) return json({ error: why }, 409);
  // Email step on by default (Jon approved the pop-over, 2026-11-16); switch it off per link on /track.
  const r = await env.DB.prepare('INSERT OR IGNORE INTO skool_links (slug, title, youtube_url, created_at, capture) VALUES (?, ?, ?, ?, 1)')
    .bind(slug, title, yt || null, iso(nowMs)).run();
  if (!r.meta?.changes) return json({ error: 'That slug is taken' }, 409);
  const { route, warning } = await ensureSlugRoute(env, slug, routes);
  return json({ ok: true, url: `${new URL(request.url).origin}/${slug}`, route, ...(warning ? { warning } : {}) }, 201);
}

// Per-link email step switch. Only Jon's session turns it on; every link starts off.
async function setCapture(request, env) {
  if (request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
  const b = await body(request);
  const slug = field(b, 'slug').toLowerCase();
  const on = b.capture === true || b.capture === 1 || b.capture === 'true' || b.capture === '1';
  const r = await env.DB.prepare('UPDATE skool_links SET capture = ? WHERE slug = ?').bind(on ? 1 : 0, slug).run();
  if (!r.meta?.changes) return json({ error: 'No such link' }, 404);
  return json({ ok: true, slug, capture: on });
}

// POST /track/api/reset {undo?: true}: signed-in only (the caller checks), same-origin, X-CC like the other /track POSTs.
async function resetStats(request, env, nowMs) {
  if (request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Wrong origin' }, 403);
  const b = await body(request);
  if (b.undo === true || b.undo === 1 || b.undo === 'true' || b.undo === '1') {
    await env.DB.prepare('DELETE FROM skool_settings WHERE key = ?').bind(RESET_KEY).run();
    return json({ ok: true, since: null });
  }
  const at = iso(nowMs);
  await env.DB.prepare('INSERT INTO skool_settings (key, value, updated_at) VALUES (?1, ?2, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(RESET_KEY, at).run();
  return json({ ok: true, since: at });
}

const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const HOW = { email: 'email match (exact)', answer: 'their answer (exact)', estimate: 'estimate: last click within 24 h', none: 'unknown' };

export function trackerPage(data, origin) {
  const rows = data.rows.map((r) => `<tr><td>${r.youtube_url ? `<a href="${esc(r.youtube_url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</td>
<td>${esc(r.slug)}</td><td><button class="copy" data-url="${esc(`${origin}/${r.slug}`)}">${esc(`${origin.replace(/^https?:\/\//, '')}/${r.slug}`)}</button></td>
<td class="n">${r.clicks.d7}</td><td class="n">${r.clicks.d30}</td><td class="n">${r.clicks.all}</td><td class="n">${r.emails}</td>
<td class="n">${r.sales}${r.estimated ? ` <span class="est" title="estimated from the last click">+${r.estimated} est.</span>` : ''}</td><td class="n">${pct(r.conversion)}</td>
<td><button class="cap" data-slug="${esc(r.slug)}" data-on="${r.capture ? 1 : 0}" aria-pressed="${r.capture}">${r.capture ? 'On' : 'Off'}</button></td></tr>`).join('');
  const sales = data.sales.slice(0, 50).map((s) => `<tr><td>${esc(s.at.slice(0, 16).replace('T', ' '))} UTC</td><td>${esc(s.name || '')}</td>
<td>${esc(s.slug || '–')}</td><td>${esc(HOW[s.how])}</td><td>${esc(s.answer || '')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Skool tracker</title><style>${BASE_CSS}</style></head><body>${nav('videos')}
<h1>Skool tracker</h1>
<div class="row"><button class="cap" id="reset" type="button">Reset stats</button><span id="since">${data.since ? `Since ${esc(data.since.slice(0, 16).replace('T', ' '))} UTC. <a href="#" id="undo">Undo reset</a>` : 'Showing all stats since the start.'}</span></div>
<p>Every short link forwards to skool.com/ai-ugc. Sales come from Zapier. Exact = the buyer's email was captured on the link, or they named the video in their answer; "est." means neither, so the sale goes to the last link clicked in the 24 hours before it.</p>
<div class="wrap"><table><thead><tr><th>Video</th><th>Slug</th><th>Short link</th><th class="n">Clicks 7d</th><th class="n">30d</th><th class="n">All</th><th class="n">Leads</th><th class="n">Sales</th><th class="n">Conversion</th><th>Email step</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10">No links yet. Add one below.</td></tr>'}</tbody></table></div>
<p>Email step: when On, the short link first asks for an email in a pop-over, then forwards to Skool. On for every new link.</p>
<p>Sales not tied to any video: ${data.unattributed}</p>
<div class="panel"><strong>Email sequence</strong> <button class="cap" id="seq" data-on="${data.seq?.on ? 1 : 0}" aria-pressed="${!!data.seq?.on}">${data.seq?.on ? 'On' : 'Off'}</button>
<p>${data.seq?.on ? 'ON: leads get the 7-day emails as they come due.' : 'OFF: nothing is sent to anyone.'} <a href="/track/emails">Read the 7 emails and send yourself a test</a>. ${data.seq && !data.seq.key ? 'Blocked: Resend key is missing.' : ''}</p></div>
<h2>Add a link</h2><form id="add"><input name="slug" placeholder="slug, e.g. seedance-ugc" required pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]">
<input name="title" placeholder="Video title" required><input name="youtube_url" placeholder="YouTube URL (optional)" type="url">
<button class="go" type="submit">Add link</button><div id="msg"></div></form>
<h2>Latest sales</h2><div class="wrap"><table><thead><tr><th>When</th><th>Member</th><th>Video</th><th>How we know</th><th>Their answer</th></tr></thead>
<tbody>${sales || '<tr><td colspan="5">No sales yet.</td></tr>'}</tbody></table></div>
<script>
document.querySelectorAll('.copy').forEach((b)=>b.onclick=()=>navigator.clipboard.writeText(b.dataset.url).then(()=>{const t=b.textContent;b.textContent='Copied';setTimeout(()=>b.textContent=t,1200)}));
document.querySelectorAll('.cap').forEach((b)=>b.onclick=async()=>{const on=b.dataset.on!=='1';
if(on&&!confirm('Turn the email step ON for '+b.dataset.slug+'? Visitors will be asked for an email before they reach Skool.'))return;
const r=await fetch('/track/api/capture',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:JSON.stringify({slug:b.dataset.slug,capture:on})});
if(r.ok){b.dataset.on=on?'1':'0';b.setAttribute('aria-pressed',on);b.textContent=on?'On':'Off'}else{alert('Could not save')}});
const resetCall=async(undo)=>{const r=await fetch('/track/api/reset',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:JSON.stringify(undo?{undo:true}:{})});
if(r.ok){location.reload()}else{alert('Could not save')}};
document.getElementById('reset').onclick=()=>{if(confirm('Reset all stats on this page to zero? Past data is kept and can be restored.'))resetCall(false)};
const undo=document.getElementById('undo');if(undo)undo.onclick=(e)=>{e.preventDefault();resetCall(true)};
document.getElementById('seq').onclick=async(e)=>{const b=e.currentTarget,on=b.dataset.on!=='1';
if(on&&!confirm('Turn the sequence ON? Real leads will start getting the 7 emails.'))return;
const r=await fetch('/track/api/sequence',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:JSON.stringify({on})});
if(r.ok){location.reload()}else{alert('Could not save')}};
document.getElementById('add').onsubmit=async(e)=>{e.preventDefault();const m=document.getElementById('msg');m.textContent='Saving...';
const r=await fetch('/track/api/links',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
const j=await r.json().catch(()=>({}));if(r.ok){if(j.warning)alert('Link saved, but '+j.warning);location.reload()}else{m.textContent=j.error||'Could not save'}};
</script></body></html>`;
}

// /track and /track/api/*.
export async function handleTracker(request, env) {
  const url = new URL(request.url);
  const nowMs = Date.now();
  const p = url.pathname;
  if (request.method === 'POST' && (p === '/track/api/sale' || p === '/track/api/answer')) return zapIntake(request, env, p.endsWith('sale') ? 'sale' : 'answer', nowMs);
  // Public: the unsubscribe link in every email (the signed token is the proof) and Resend's webhook (Svix-signed).
  if (p === '/track/unsub' && ['GET', 'POST'].includes(request.method)) return handleUnsub(request, env, nowMs);
  if (p === '/track/api/resend' && request.method === 'POST') return handleResendWebhook(request, env, nowMs);
  const signedIn = await readSession(request, env);
  const html = (body) => new Response(body, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  // The pages are chosen by path, whatever the method: signed out always goes to the sign-in, and only GET and HEAD read them.
  if (['/track', '/track/', '/track/leads', '/track/leads.csv', '/track/emails'].includes(p)) {
    if (!signedIn) return new Response(null, { status: 302, headers: { Location: `${url.origin}/dash/`, ...NO_STORE } });
    if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed' }, 405);
  }
  if (p === '/track' || p === '/track/') {
    const data = await trackerData(env.DB, nowMs);
    data.seq = await seqStatus(env);
    return html(trackerPage(data, url.origin));
  }
  if (p === '/track/leads' || p === '/track/leads.csv') {
    const q = (url.searchParams.get('q') || '').slice(0, 100), f = FILTERS.some(([k]) => k === url.searchParams.get('f')) ? url.searchParams.get('f') : 'all';
    const data = await leadsData(env.DB, { q, f });
    if (p.endsWith('.csv')) return new Response(leadsCsv(data.rows), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="skool-leads.csv"', ...NO_STORE } });
    return html(leadsPage(data, { q, f }));
  }
  if (p === '/track/emails') {
    const st = await seqStatus(env);
    const link = await env.DB.prepare('SELECT slug, title FROM skool_links ORDER BY created_at DESC LIMIT 1').first();
    return html(emailsPage({ on: st.on, keySet: st.key, addressSet: st.address, business: env.SKOOL_BUSINESS || DEFAULT_BUSINESS, sample: { title: link?.title || 'Your video title', slug: link?.slug || 'your-video' }, origin: url.origin }));
  }
  if (!signedIn) return json({ error: 'Sign in' }, 401);
  if (p === '/track/api/links' && request.method === 'POST') return addLink(request, env, nowMs);
  if (p === '/track/api/capture' && request.method === 'POST') return setCapture(request, env);
  if (p === '/track/api/reset' && request.method === 'POST') return resetStats(request, env, nowMs);
  if (p === '/track/api/sequence' && request.method === 'POST') return setSequence(request, env, nowMs);
  if (p === '/track/api/sequence/test' && request.method === 'POST') {
    if (request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
    const r = await sendTest(env, nowMs);
    return json(r.body, r.status);
  }
  if (p === '/track/api/data' && request.method === 'GET') return json(await trackerData(env.DB, nowMs));
  return json({ error: 'Not found' }, 404);
}

export async function seqStatus(env) {
  return { on: await seqOn(env.DB), key: !!env.RESEND_API_KEY, address: !addressIsPlaceholder(env) };
}

// The master switch. Off unless Jon's own signed-in click turns it on.
async function setSequence(request, env, nowMs) {
  if (request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
  const b = await body(request);
  const on = b.on === true || b.on === 1 || b.on === 'true' || b.on === '1';
  await setSeqOn(env.DB, on, nowMs);
  return json({ ok: true, on });
}
