// Skool tracker (Jon, 2026-11-16): one short link per YouTube video, jonmac.ai/s/<slug>, that counts the click and
// forwards to the Skool group. Paid members come in from Jon's Zapier zaps; /track shows clicks and sales per video.
// Skool has no API or webhooks: Zapier's "New Paid Member" and "Answered Membership Questions" triggers POST here
// with the SKOOL_ZAP_TOKEN secret. Attribution of a sale, best first: the buyer's email was captured on a link (the
// optional email step, off by default, switched per link on /track), else the member's answer names a video, else
// an estimate: the last click in the 24 hours before it.
import { readSession, timingSafeEqualString } from './auth.js';

export const SKOOL = 'https://www.skool.com/ai-ugc';
export const ESTIMATE_HOURS = 24;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const YT_RE = /^https:\/\/(www\.|m\.)?(youtube\.com\/(watch\?v=|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i;
const EMAIL_RE = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,190}\.[^\s@<>"']{2,24}$/;
const MAX_LEADS_PER_10_MIN = 60; // per link: stops a script from filling the table
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...NO_STORE } });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const iso = (ms) => new Date(ms).toISOString();
const forward = (to) => new Response(null, { status: 302, headers: { Location: to.href, ...NO_STORE } });

// GET /s/<slug>: forwards, so a viewer never hits a dead end; only known slugs and real GETs are counted.
// UTM tags ride along (Skool keeps them on its /about page; checked 2026-11-16). Never ?ref=: that is Skool's affiliate tag.
// A link with the email step on (skool_links.capture = 1) shows a one-field page first; its POST stores the email and forwards.
export async function skoolRedirect(request, env, ctx) {
  const url = new URL(request.url);
  const slug = url.pathname.slice('/s/'.length).toLowerCase();
  const to = new URL(SKOOL);
  if (!SLUG_RE.test(slug) || !['GET', 'HEAD', 'POST'].includes(request.method)) return forward(to);
  to.searchParams.set('utm_source', 'youtube');
  to.searchParams.set('utm_medium', 'video');
  to.searchParams.set('utm_campaign', slug);
  if (!env.DB) return forward(to);
  let link = null;
  try { link = await env.DB.prepare('SELECT capture FROM skool_links WHERE slug = ?').bind(slug).first(); } catch (err) { console.error('skool link', err); }
  if (!link) return forward(to); // unknown slug: forward, count nothing
  const capture = link.capture === 1;
  if (request.method === 'POST') {
    if (!capture) return forward(to);
    const email = field(await body(request), 'email').toLowerCase();
    if (email.length > 254 || !EMAIL_RE.test(email)) return capturePage(slug, 'Please enter a valid email address.', 400);
    // Never log the email: a failure prints the slug only.
    try {
      const now = Date.now();
      const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM skool_leads WHERE slug = ? AND at >= ?').bind(slug, iso(now - 600e3)).first();
      if ((recent?.n || 0) < MAX_LEADS_PER_10_MIN) {
        await env.DB.prepare('INSERT INTO skool_leads (slug, email, at) VALUES (?, ?, ?) ON CONFLICT(slug, email) DO UPDATE SET at = excluded.at')
          .bind(slug, email, iso(now)).run();
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

function capturePage(slug, error, status) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>Get access</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1115;color:#e8e8ea}
main{width:min(26rem,90vw)}h1{font-size:1.4rem;margin:0 0 1rem}form{display:grid;gap:.75rem}
input{font:inherit;padding:.75rem .9rem;border-radius:.6rem;border:1px solid #303644;background:#161a21;color:#e8e8ea}
button{font:inherit;font-weight:600;cursor:pointer;border:0;border-radius:.6rem;padding:.75rem 1rem;background:#3b6cff;color:#fff}
.err{color:#ff8a8a;margin:0 0 .75rem}.note{color:#a0a3ab;font-size:.85rem;margin:1rem 0 0}</style></head><body><main>
<h1>Enter your email to get access</h1>${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="/s/${esc(slug)}"><input type="email" name="email" placeholder="you@example.com" autocomplete="email" required autofocus maxlength="254">
<button type="submit">Continue</button></form>
<p class="note">We use your email only to see which video sent you; it stays on jonmac.ai.</p></main></body></html>`;
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
  const t = s ? Date.parse(s) : NaN;
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
  await env.DB.prepare('INSERT OR IGNORE INTO skool_sales (id, email, name, at, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, email || null, name.slice(0, 120) || null, at, iso(nowMs)).run();
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
    if (raw.includes(`/s/${l.slug}`) || (id && String(answer).includes(id)) || (l.slug.length >= 6 && ` ${a} `.includes(` ${norm(l.slug)} `))) return l.slug; // short slugs like "ai" match too much
  }
  for (const l of links) {
    const t = norm(l.title);
    if (t && (a.includes(t) || (a.length >= 12 && t.includes(a)))) return l.slug;
  }
  return null;
}

export async function trackerData(db, nowMs = Date.now()) {
  const d7 = iso(nowMs - 7 * 864e5), d30 = iso(nowMs - 30 * 864e5);
  const [links, clicks, sales, answers, leads] = await Promise.all([
    db.prepare('SELECT slug, title, youtube_url, created_at, capture FROM skool_links ORDER BY created_at DESC').all(),
    db.prepare(`SELECT slug, COUNT(*) AS total, SUM(at >= ?) AS d7, SUM(at >= ?) AS d30 FROM skool_clicks GROUP BY slug`).bind(d7, d30).all(),
    db.prepare('SELECT id, email, name, at FROM skool_sales ORDER BY at DESC LIMIT 2000').all(),
    db.prepare('SELECT email, answer FROM skool_answers').all(),
    db.prepare('SELECT slug, email, at FROM skool_leads ORDER BY at DESC LIMIT 50000').all(),
  ]);
  const L = links.results || [];
  const known = new Set(L.map((l) => l.slug));
  const C = new Map((clicks.results || []).map((c) => [c.slug, c]));
  const A = new Map((answers.results || []).map((x) => [x.email, x.answer]));
  const byEmail = new Map(); // email -> its leads, newest first
  const captured = new Map(); // slug -> emails captured
  for (const x of leads.results || []) {
    if (!known.has(x.slug)) continue;
    captured.set(x.slug, (captured.get(x.slug) || 0) + 1);
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
  return { rows, sales: list, unattributed: list.filter((x) => !x.slug).length };
}

async function addLink(request, env, nowMs) {
  if (request.headers.get('X-CC') !== '1') return json({ error: 'Missing header' }, 403);
  const b = await body(request);
  const slug = field(b, 'slug').toLowerCase(), title = field(b, 'title').slice(0, 200), yt = field(b, 'youtube_url');
  if (!SLUG_RE.test(slug)) return json({ error: 'Slug: 2 to 40 lower-case letters, numbers or dashes' }, 400);
  if (!title) return json({ error: 'Title is required' }, 400);
  if (yt && !YT_RE.test(yt)) return json({ error: 'YouTube URL must be a youtube.com or youtu.be video link' }, 400);
  const r = await env.DB.prepare('INSERT OR IGNORE INTO skool_links (slug, title, youtube_url, created_at) VALUES (?, ?, ?, ?)')
    .bind(slug, title, yt || null, iso(nowMs)).run();
  if (!r.meta?.changes) return json({ error: 'That slug is taken' }, 409);
  return json({ ok: true, url: `${new URL(request.url).origin}/s/${slug}` }, 201);
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

const pct = (x) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`);
const HOW = { email: 'email match (exact)', answer: 'their answer (exact)', estimate: 'estimate: last click within 24 h', none: 'unknown' };

export function trackerPage(data, origin) {
  const rows = data.rows.map((r) => `<tr><td>${r.youtube_url ? `<a href="${esc(r.youtube_url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</td>
<td>${esc(r.slug)}</td><td><button class="copy" data-url="${esc(`${origin}/s/${r.slug}`)}">${esc(`${origin.replace(/^https?:\/\//, '')}/s/${r.slug}`)}</button></td>
<td class="n">${r.clicks.d7}</td><td class="n">${r.clicks.d30}</td><td class="n">${r.clicks.all}</td><td class="n">${r.emails}</td>
<td class="n">${r.sales}${r.estimated ? ` <span class="est" title="estimated from the last click">+${r.estimated} est.</span>` : ''}</td><td class="n">${pct(r.conversion)}</td>
<td><button class="cap" data-slug="${esc(r.slug)}" data-on="${r.capture ? 1 : 0}" aria-pressed="${r.capture}">${r.capture ? 'On' : 'Off'}</button></td></tr>`).join('');
  const sales = data.sales.slice(0, 50).map((s) => `<tr><td>${esc(s.at.slice(0, 16).replace('T', ' '))} UTC</td><td>${esc(s.name || '')}</td>
<td>${esc(s.slug || '–')}</td><td>${esc(HOW[s.how])}</td><td>${esc(s.answer || '')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Skool tracker</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:1.25rem;background:#0f1115;color:#e8e8ea}
h1{font-size:1.3rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.75rem 0 .5rem}p{color:#a0a3ab;margin:.25rem 0 1rem}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{padding:.5rem .6rem;border-bottom:1px solid #262a33;text-align:left;vertical-align:top}
th{color:#a0a3ab;font-weight:600}.n{text-align:right;white-space:nowrap}a{color:#8ab4ff}.est{color:#e0b060;font-size:.85em}
button{font:inherit;cursor:pointer;border-radius:.5rem}.copy,.cap{background:#1b1f27;color:#e8e8ea;border:1px solid #303644;padding:.25rem .5rem;white-space:nowrap}
.cap[aria-pressed=true]{background:#1f6b3a;border-color:#2a8a4c}
form{display:grid;gap:.5rem;max-width:34rem}input{font:inherit;padding:.55rem .7rem;border-radius:.5rem;border:1px solid #303644;background:#161a21;color:#e8e8ea}
.go{background:#3b6cff;color:#fff;border:0;padding:.6rem 1rem;font-weight:600}#msg{min-height:1.2em;color:#a0a3ab}</style></head><body>
<h1>Skool tracker</h1><p>Every short link forwards to skool.com/ai-ugc. Sales come from Zapier. Exact = the buyer's email was captured on the link, or they named the video in their answer; "est." means neither, so the sale goes to the last link clicked in the 24 hours before it.</p>
<div class="wrap"><table><thead><tr><th>Video</th><th>Slug</th><th>Short link</th><th class="n">Clicks 7d</th><th class="n">30d</th><th class="n">All</th><th class="n">Emails</th><th class="n">Sales</th><th class="n">Conversion</th><th>Email step</th></tr></thead>
<tbody>${rows || '<tr><td colspan="10">No links yet. Add one below.</td></tr>'}</tbody></table></div>
<p>Email step: when On, the short link first asks for an email ("We use your email only to see which video sent you; it stays on jonmac.ai."), then forwards to Skool. Off for every new link.</p>
<p>Sales not tied to any video: ${data.unattributed}</p>
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
document.getElementById('add').onsubmit=async(e)=>{e.preventDefault();const m=document.getElementById('msg');m.textContent='Saving...';
const r=await fetch('/track/api/links',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:JSON.stringify(Object.fromEntries(new FormData(e.target)))});
const j=await r.json().catch(()=>({}));if(r.ok){location.reload()}else{m.textContent=j.error||'Could not save'}};
</script></body></html>`;
}

// /track and /track/api/*.
export async function handleTracker(request, env) {
  const url = new URL(request.url);
  const nowMs = Date.now();
  const p = url.pathname;
  if (request.method === 'POST' && (p === '/track/api/sale' || p === '/track/api/answer')) return zapIntake(request, env, p.endsWith('sale') ? 'sale' : 'answer', nowMs);
  const signedIn = await readSession(request, env);
  if (p === '/track' || p === '/track/') {
    if (!signedIn) return new Response(null, { status: 302, headers: { Location: `${url.origin}/dash/`, ...NO_STORE } });
    const html = trackerPage(await trackerData(env.DB, nowMs), url.origin);
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  if (!signedIn) return json({ error: 'Sign in' }, 401);
  if (p === '/track/api/links' && request.method === 'POST') return addLink(request, env, nowMs);
  if (p === '/track/api/capture' && request.method === 'POST') return setCapture(request, env);
  if (p === '/track/api/data' && request.method === 'GET') return json(await trackerData(env.DB, nowMs));
  return json({ error: 'Not found' }, 404);
}
