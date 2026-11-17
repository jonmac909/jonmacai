// /track Leads (one row per email), CSV export, and the email preview page. Signed-in only (routed from skool.js).
import { EMAILS, SEQUENCE_DAYS, renderEmail, PRICE_LINE } from './skoolmail.js';
import { TEST_TO, DEFAULT_BUSINESS, ADDRESS_PLACEHOLDER } from './skoolseq.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const BASE_CSS = `body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:1.25rem;background:#0f1115;color:#e8e8ea}
h1{font-size:1.3rem;margin:0 0 .25rem}h2{font-size:1.05rem;margin:1.75rem 0 .5rem}p{color:#a0a3ab;margin:.25rem 0 1rem}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:.92rem}th,td{padding:.5rem .6rem;border-bottom:1px solid #262a33;text-align:left;vertical-align:top}
th{color:#a0a3ab;font-weight:600}.n{text-align:right;white-space:nowrap}a{color:#8ab4ff}.est{color:#e0b060;font-size:.85em}
button{font:inherit;cursor:pointer;border-radius:.5rem}.copy,.cap{background:#1b1f27;color:#e8e8ea;border:1px solid #303644;padding:.25rem .5rem;white-space:nowrap}
.cap[aria-pressed=true]{background:#1f6b3a;border-color:#2a8a4c}
form{display:grid;gap:.5rem;max-width:34rem}input,select{font:inherit;padding:.55rem .7rem;border-radius:.5rem;border:1px solid #303644;background:#161a21;color:#e8e8ea}
.go{background:#3b6cff;color:#fff;border:0;padding:.6rem 1rem;font-weight:600}#msg{min-height:1.2em;color:#a0a3ab}
.nav{display:flex;gap:1rem;margin:0 0 1rem;flex-wrap:wrap}.nav a{color:#a0a3ab;text-decoration:none;padding:.3rem 0;border-bottom:2px solid transparent}.nav a[aria-current=page]{color:#fff;border-color:#8ab4ff}
.row{display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;max-width:none}.row form{display:flex;gap:.5rem;flex-wrap:wrap;max-width:none}
.tag{display:inline-block;padding:.05rem .45rem;border-radius:1rem;font-size:.82em;border:1px solid #303644}.ok{color:#7fd69a;border-color:#2a8a4c}.warn{color:#e0b060;border-color:#7a5a20}.bad{color:#ff8a80;border-color:#7a2a2a}
.panel{border:1px solid #262a33;border-radius:.6rem;padding:.8rem 1rem;margin:1rem 0;background:#13161c}.mail{background:#fff;color:#1f1f1f;border-radius:.5rem;margin:.5rem 0 1rem;overflow:hidden}.sub{font-weight:600;margin:1.5rem 0 .25rem}
pre{white-space:pre-wrap;background:#161a21;border:1px solid #303644;border-radius:.5rem;padding:.7rem;color:#c8cad0;font-size:.85rem}`;

export const nav = (active) => `<nav class="nav" aria-label="Skool tracker">${[['videos', '/track', 'Videos and sales'], ['leads', '/track/leads', 'Leads'], ['emails', '/track/emails', 'Email sequence']]
  .map(([k, href, label]) => `<a href="${href}"${k === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;

const shell = (title, active, body, script = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${nav(active)}${body}${script ? `<script>${script}</script>` : ''}</body></html>`;

// ---- leads ----
const iso = (ms) => new Date(ms).toISOString();
export const FILTERS = [['all', 'All'], ['bought', 'Bought'], ['notbought', 'Not bought'], ['unsub', 'Unsubscribed'], ['bounced', 'Bounced or complained']];

export async function leadsData(db, { q = '', f = 'all' } = {}) {
  const [leads, links, sales, sends, stops] = await Promise.all([
    db.prepare('SELECT slug, email, at, last_at, email_check FROM skool_leads ORDER BY at LIMIT 50000').all(),
    db.prepare('SELECT slug, title FROM skool_links').all(),
    db.prepare("SELECT email, at, amount FROM skool_sales WHERE email IS NOT NULL AND email != '' ORDER BY at").all(),
    db.prepare('SELECT email, day, status, sent_at, opened_at, error FROM skool_seq_sends').all(),
    db.prepare('SELECT email, reason, at FROM skool_seq_stops').all(),
  ]);
  const title = new Map((links.results || []).map((l) => [l.slug, l.title]));
  const S = new Map(); for (const s of sales.results || []) { const o = S.get(s.email); if (!o) S.set(s.email, { at: s.at, amount: s.amount == null ? null : Number(s.amount), n: 1 }); else { o.n++; if (s.amount != null) o.amount = (o.amount || 0) + Number(s.amount); } }
  const D = new Map(); for (const s of sends.results || []) { if (!D.has(s.email)) D.set(s.email, []); D.get(s.email).push(s); }
  const X = new Map((stops.results || []).map((s) => [s.email, s]));
  const byEmail = new Map();
  for (const l of leads.results || []) { if (!byEmail.has(l.email)) byEmail.set(l.email, []); byEmail.get(l.email).push(l); }
  let rows = [...byEmail].map(([email, ls]) => {
    const first = ls[0]; // oldest first
    const newest = [...ls].sort((a, b) => (b.last_at || b.at).localeCompare(a.last_at || a.at))[0];
    const sale = S.get(email) || null, stop = X.get(email) || null, mine = D.get(email) || [];
    const sent = mine.filter((m) => m.status === 'sent'), day = sent.length ? Math.max(...sent.map((m) => m.day)) : -1;
    const opened = mine.some((m) => m.opened_at), failed = mine.find((m) => m.status === 'failed');
    const check = newest.email_check || null;
    let label;
    if (stop) label = `${stop.reason}${day >= 0 ? ` after day ${day}` : ''}`;
    else if (sale && day < SEQUENCE_DAYS - 1) label = `stopped: bought${day >= 0 ? ` after day ${day}` : ''}`;
    else if (sale) label = 'finished (bought)';
    else if (check === 'suggested' && day < 0) label = 'not sent: typo kept';
    else if (failed) label = `day ${failed.day} failed`;
    else if (day === SEQUENCE_DAYS - 1) label = 'finished';
    else if (day >= 0) label = `day ${day} sent`;
    else label = 'not started';
    return {
      email, first_slug: first.slug, first_title: title.get(first.slug) || '', videos: [...new Set(ls.map((x) => x.slug))],
      first_seen: first.at, last_seen: ls.reduce((m, x) => ((x.last_at || x.at) > m ? (x.last_at || x.at) : m), first.at), check,
      bought: !!sale, amount: sale?.amount ?? null, sale_at: sale?.at || null,
      seq: label, day, opened, stop: stop?.reason || '',
    };
  });
  const total = rows.length;
  const needle = q.trim().toLowerCase();
  if (needle) rows = rows.filter((r) => r.email.includes(needle) || r.videos.some((v) => v.includes(needle) || (title.get(v) || '').toLowerCase().includes(needle)));
  if (f === 'bought') rows = rows.filter((r) => r.bought);
  else if (f === 'notbought') rows = rows.filter((r) => !r.bought);
  else if (f === 'unsub') rows = rows.filter((r) => r.stop === 'unsubscribed');
  else if (f === 'bounced') rows = rows.filter((r) => r.stop === 'bounced' || r.stop === 'complained');
  rows.sort((a, b) => b.last_seen.localeCompare(a.last_seen));
  return { rows, total };
}

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // a spreadsheet must not run an email like =x@y.com as a formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function leadsCsv(rows, titleOf = () => '') {
  const head = ['email', 'first_video_slug', 'first_video_title', 'all_videos', 'first_seen', 'last_seen', 'email_check', 'bought', 'amount', 'sale_date', 'sequence_status', 'last_day_sent', 'opened', 'stopped'];
  const lines = [head.join(',')];
  for (const r of rows) {
    lines.push([r.email, r.first_slug, r.first_title || titleOf(r.first_slug), r.videos.join(' '), r.first_seen, r.last_seen, r.check || '', r.bought ? 'yes' : 'no', r.amount ?? '', r.sale_at || '', r.seq, r.day >= 0 ? r.day : '', r.opened ? 'yes' : 'no', r.stop]
      .map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

const fmt = (s) => (s ? esc(s.slice(0, 16).replace('T', ' ')) : '–');
const money = (n) => (n == null ? '' : ` $${Number.isInteger(n) ? n : n.toFixed(2)}`);
export function leadsPage(data, { q = '', f = 'all' } = {}) {
  const shown = data.rows.slice(0, 500);
  const qs = new URLSearchParams({ ...(q ? { q } : {}), ...(f !== 'all' ? { f } : {}) }).toString();
  const body = shown.map((r) => `<tr><td>${esc(r.email)}</td><td>${esc(r.first_slug)}${r.first_title ? `<br><span class="est">${esc(r.first_title)}</span>` : ''}</td>
<td>${r.videos.map(esc).join(', ')}</td><td>${fmt(r.first_seen)}</td><td>${fmt(r.last_seen)}</td>
<td>${r.check ? `<span class="tag ${r.check === 'valid' ? 'ok' : 'warn'}">${esc(r.check)}</span>` : '–'}</td>
<td>${r.bought ? `<span class="tag ok">yes</span>${esc(money(r.amount))}<br><span class="est">${fmt(r.sale_at)}</span>` : 'no'}</td>
<td>${r.stop ? `<span class="tag bad">${esc(r.seq)}</span>` : esc(r.seq)}${r.opened ? ' <span class="tag ok">opened</span>' : ''}</td></tr>`).join('');
  return shell('Skool leads', 'leads', `<h1>Leads</h1><p>One row per email, from the pop-over. ${data.total} in all${shown.length < data.rows.length ? `, showing the newest ${shown.length} of ${data.rows.length} matches (the CSV has every match)` : ''}. Times are UTC.</p>
<div class="row"><form method="get" action="/track/leads"><input type="search" name="q" value="${esc(q)}" placeholder="Search email or video" aria-label="Search" maxlength="100">
<select name="f" aria-label="Filter">${FILTERS.map(([k, l]) => `<option value="${k}"${k === f ? ' selected' : ''}>${l}</option>`).join('')}</select><button class="go" type="submit">Search</button></form>
<a href="/track/leads.csv${qs ? `?${esc(qs)}` : ''}" download>Download CSV</a></div>
<div class="wrap"><table><thead><tr><th>Email</th><th>First video</th><th>All videos</th><th>First seen</th><th>Last seen</th><th>Check</th><th>Bought</th><th>Email sequence</th></tr></thead>
<tbody>${body || '<tr><td colspan="8">No leads match.</td></tr>'}</tbody></table></div>`);
}

// ---- email preview + switch + test ----
export function emailsPage({ on, keySet, addressSet, business, sample, origin, testTo = TEST_TO }) {
  const mails = EMAILS.map((e) => {
    const m = renderEmail(e.day, { title: sample.title, slug: sample.slug, unsubUrl: `${origin}/track/unsub?e=person%40example.com&t=preview`, business, address: addressSet ? '(your address)' : ADDRESS_PLACEHOLDER });
    return `<div class="sub">Day ${e.day}: ${esc(m.subject)}</div><div class="mail">${m.html.replace(/^<!doctype html><html><body[^>]*>/, '').replace(/<\/body><\/html>$/, '')}</div>
<details><summary>Plain text version</summary><pre>${esc(m.text)}</pre></details>`;
  }).join('\n');
  return shell('Skool email sequence', 'emails', `<h1>Email sequence</h1>
<p>Seven emails for the AI Video Lab, sent by Resend. Day 0 goes out right after the email is entered, then one a day, 24 hours after the last. It stops for a lead when they buy, unsubscribe, bounce or complain. Below is exactly how each one looks (example video: "${esc(sample.title)}").</p>
<div class="panel"><div class="row"><strong>Sequence</strong> <button class="cap" id="seq" data-on="${on ? 1 : 0}" aria-pressed="${on}">${on ? 'On' : 'Off'}</button>
<button class="go" id="test"${keySet ? '' : ' disabled'}>Send me a test</button><span id="msg"></span></div>
<p>${on ? 'ON: real leads get the emails as they come due.' : 'OFF: nothing is sent to anyone.'} The test sends all seven to ${esc(testTo)} only, with [TEST] in the subject.</p>
<p>Resend key: ${keySet ? '<span class="tag ok">set</span>' : '<span class="tag bad">missing</span> Blocked: Resend key. Nothing can be sent until the RESEND_API_KEY secret is added to this Worker.'}
 &nbsp; Mailing address: ${addressSet ? '<span class="tag ok">set</span>' : '<span class="tag bad">still [ADDRESS]</span> Real sends stay paused until the SKOOL_ADDRESS setting has the real address (the test send still works).'}
 &nbsp; Business name: ${esc(business)}. Price line in the copy: ${esc(PRICE_LINE)}.</p></div>${mails}`,
  `const msg=document.getElementById('msg');
document.getElementById('seq').onclick=async(e)=>{const b=e.currentTarget,on=b.dataset.on!=='1';
if(on&&!confirm('Turn the sequence ON? Real leads will start getting these ${SEQUENCE_DAYS} emails.'))return;
const r=await fetch('/track/api/sequence',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:JSON.stringify({on})});
if(r.ok){location.reload()}else{msg.textContent='Could not save'}};
const t=document.getElementById('test');t.onclick=async()=>{t.disabled=true;msg.textContent='Sending 7 emails...';
const r=await fetch('/track/api/sequence/test',{method:'POST',headers:{'Content-Type':'application/json','X-CC':'1'},body:'{}'});
const j=await r.json().catch(()=>({}));msg.textContent=r.ok?'Sent. Check ${esc(testTo)}.':(j.error||'Some failed: '+JSON.stringify(j.results||[]));t.disabled=false};`);
}
