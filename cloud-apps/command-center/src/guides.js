// Guide site (spec jonmac-guide-site-spec-2026-11-23): one open guide page per video, a home page that sells AI Video Lab,
// and counted Skool forwards. Server-rendered HTML: everything reads with no script; the small inline script only adds the
// one-click download, search and filters.
//   GET  /guides                  index of listed guides, newest first
//   GET  /guides/<slug>           the guide (unlisted: live but noindex and not in the index)
//   GET  /guides/<slug>/img/<f>   guide images from R2 (UPLOADS, guides/<slug>/img/<f>)
//   POST /guides/<slug>/download  email (+ Terms tick, optional newsletter tick) -> the file; the email joins skool_leads
//   POST /guides/newsletter       footer newsletter box
//   PUT  /guides/api/<slug>       publish from MacFrames: Bearer GUIDES_PUBLISH_TOKEN, JSON {guide, files: {path: base64}}
//   GET  /guides/api/<slug>/stats counts for one guide (same token)
//   GET  /go/skool?from=&pos=     count, then 302 to the Skool about page
//   GET  /lab                     the home page
// /s/<slug> and root slugs show the guide (or /lab) only when GUIDES_S_SWITCH is "on" (src/skool.js); off by default.
import { timingSafeEqualString } from './auth.js';
import { checkEmail } from './skoolcheck.js';
import { SLUG_RE } from './skoolroutes.js';

export const SKOOL_ABOUT = 'https://www.skool.com/ai-ugc/about';
const GROUP = 'AI Video Lab';
const PRICE = '$9 / month';
const TAGLINE = 'Master video production with Claude. Get the exact skills, prompts and files that grow your income.';
const MEMBERS = { count: '1.1k', asOf: '2026-11-23' }; // read from the Skool about page; update with the date when re-read
export const POS = new Set(['rail', 'end', 'top', 'home', 'bar']);
const NOT_SLUGS = new Set(['api', 'terms', 'newsletter']); // /guides/<these> are pages, never guides
const FILE_RE = /^(resource|img)\/[A-Za-z0-9][\w.-]{0,99}$/;
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', zip: 'application/zip', md: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', pdf: 'application/pdf', json: 'application/json' };
const MAX_EMAILS_PER_10_MIN = 60; // per guide: stops a script from filling the list
const EMAIL_COOKIE = 'jm_email';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const ext = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
const html = (body, { status = 200, index = true } = {}) => new Response(body, { status, headers: {
  'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff',
  ...(index ? {} : { 'X-Robots-Tag': 'noindex' }) } });
const fmtDate = (d) => { const t = Date.parse(`${d}T12:00:00Z`); return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : ''; };
const skoolHref = (slug, pos) => `/go/skool?${new URLSearchParams({ ...(slug ? { from: slug } : {}), pos })}`;
const authed = (request, env) => {
  const secret = env.GUIDES_PUBLISH_TOKEN || '';
  return secret.length >= 32 && timingSafeEqualString(request.headers.get('Authorization') || '', `Bearer ${secret}`);
};

// ---- Markdown (the small safe subset guides use): escaped first, so no raw HTML gets through.
function inline(text, slug) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/!\[([^\]]*)\]\((img\/[A-Za-z0-9][\w.-]{0,99})\)/g, (_, alt, src) => `<img src="/guides/${slug}/${src}" alt="${alt}" loading="lazy">`)
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^)\s]*)\)/g, (_, t, href) => `<a href="${href}"${href.startsWith('http') ? ' rel="noopener" target="_blank"' : ''}>${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
}
export function md(src, slug = '') {
  const out = [];
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  let para = [], list = null;
  const flushPara = () => { if (para.length) out.push(`<p>${inline(para.join(' '), slug)}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i, slug)}</li>`).join('')}</${list.tag}>`); list = null; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      while (++i < lines.length && !/^```/.test(lines[i])) code.push(lines[i]);
      out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
      continue;
    }
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const n = Math.min(m[1].length + 2, 5); out.push(`<h${n}>${inline(m[2], slug)}</h${n}>`); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1], slug)}</blockquote>`); continue; }
    if ((m = /^\s*(?:[-*]|(\d+)[.)])\s+(.*)$/.exec(line))) {
      flushPara();
      const tag = m[1] ? 'ol' : 'ul';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(m[2]);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return out.join('\n');
}

// ---- Data
export async function loadGuide(env, slug) {
  if (!env.DB || !SLUG_RE.test(slug)) return null;
  try {
    const row = await env.DB.prepare('SELECT json, state FROM guides WHERE slug = ?').bind(slug).first();
    if (!row) return null;
    const g = JSON.parse(row.json);
    return { ...g, slug, state: row.state };
  } catch (err) { console.error('guide load', slug, err.message); return null; }
}
async function listed(env) {
  if (!env.DB) return [];
  try {
    const r = await env.DB.prepare("SELECT slug, json FROM guides WHERE state = 'listed' ORDER BY updated DESC, published_at DESC LIMIT 1000").all();
    return (r.results || []).map((x) => ({ ...JSON.parse(x.json), slug: x.slug }));
  } catch (err) { console.error('guide list', err.message); return []; }
}
function count(env, ctx, slug, kind, pos = null) {
  if (!env.DB) return;
  const p = env.DB.prepare('INSERT INTO guide_events (slug, kind, pos, at) VALUES (?, ?, ?, ?)').bind(slug || null, kind, pos, iso()).run()
    .catch((err) => console.error('guide count', kind, err.message));
  if (ctx?.waitUntil) ctx.waitUntil(p);
  return p;
}
export async function guideStats(db, slug) {
  const [ev, em] = await Promise.all([
    db.prepare('SELECT kind, pos, COUNT(*) AS n FROM guide_events WHERE slug = ? GROUP BY kind, pos').bind(slug).all(),
    db.prepare('SELECT COUNT(DISTINCT email) AS n FROM guide_emails WHERE slug = ?').bind(slug).first(),
  ]);
  const out = { slug, visits: 0, skool: {}, skool_total: 0, downloads: 0, emails: em?.n || 0 };
  for (const r of ev.results || []) {
    if (r.kind === 'visit') out.visits += r.n;
    else if (r.kind === 'download') out.downloads += r.n;
    else if (r.kind === 'skool') { out.skool[r.pos || 'other'] = (out.skool[r.pos || 'other'] || 0) + r.n; out.skool_total += r.n; }
  }
  return out;
}

// ---- Page shell
const CSS = `*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font:17px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1b1b1b;background:#fff}
a{color:#0b57d0}img{max-width:100%;height:auto;border-radius:10px}
.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.7rem 1.1rem;border-bottom:1px solid #eee;position:sticky;top:0;background:rgba(255,255,255,.96);z-index:5}
.brand{font-weight:800;color:#111;text-decoration:none;letter-spacing:-.01em}.top nav{display:flex;gap:1rem;align-items:center;font-size:.95rem}.top nav a{color:#333;text-decoration:none}
.btn{display:inline-block;background:#f8d481;color:#1b1b1b;font-weight:700;text-decoration:none;border:0;border-radius:10px;padding:.75rem 1.15rem;cursor:pointer;font:inherit;font-weight:700;line-height:1.2;text-align:center}
.btn:hover{background:#f5c961}.btn.sm{padding:.45rem .8rem;font-size:.9rem}.btn.dark{background:#111;color:#fff}.btn.dark:hover{background:#333}
.wrap{max-width:1120px;margin:0 auto;padding:1.25rem 1.1rem 2rem;display:grid;gap:2.5rem}
@media(min-width:900px){.wrap.g{grid-template-columns:minmax(0,1fr) 300px}}
article{min-width:0;max-width:720px}h1{font-size:clamp(1.8rem,4.5vw,2.6rem);line-height:1.15;margin:.4rem 0 .6rem;letter-spacing:-.02em}
h2{font-size:1.5rem;line-height:1.25;margin:2.4rem 0 .6rem;scroll-margin-top:4.5rem}h3,h4,h5{line-height:1.3;margin:1.6rem 0 .4rem}
.meta{color:#666;font-size:.92rem}.sum{background:#fbf6e6;border:1px solid #f1e2b0;border-radius:12px;padding:1rem 1.2rem;margin:1.2rem 0}
.sum ul{margin:.3rem 0 0;padding-left:1.2rem}.vid{position:relative;aspect-ratio:16/9;margin:1.2rem 0;border-radius:12px;overflow:hidden;background:#000}.vid iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.toc{border:1px solid #eee;border-radius:12px;padding:.9rem 1.2rem;margin:1.2rem 0}.toc ol{margin:.3rem 0 0;padding-left:1.3rem}.toc a{color:#222}
pre{background:#f5f5f5;padding:.9rem;border-radius:8px;overflow:auto;font-size:.88rem}code{font-size:.92em;background:#f3f3f3;padding:.1em .3em;border-radius:4px}pre code{background:none;padding:0}
blockquote{margin:1rem 0;padding:.2rem 1rem;border-left:4px solid #f8d481;color:#444}figure{margin:1.2rem 0}
.res{border:2px solid #111;border-radius:14px;padding:1.2rem 1.3rem;margin:2.4rem 0;scroll-margin-top:4.5rem}.res h2{margin-top:0}.res .k{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:#666;font-weight:700}
details.dl{margin-top:.8rem}details.dl summary{list-style:none;display:inline-block}details.dl summary::-webkit-details-marker{display:none}
.box{margin-top:.8rem;border:1px solid #ddd;border-radius:12px;padding:1rem;max-width:26rem;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08)}
.box form{display:grid;gap:.65rem}.box input[type=email],.nl input[type=email]{font:inherit;padding:.7rem .85rem;border:1px solid #c9c9c9;border-radius:8px;width:100%}
.box label{display:flex;gap:.55rem;align-items:flex-start;font-size:.9rem;line-height:1.4}.box label input{margin-top:.2rem;flex:none;width:1.05rem;height:1.05rem}
.err{color:#b3261e;font-size:.92rem;margin:0}.who{font-size:.85rem;color:#666;margin:.5rem 0 0}
.chk{list-style:none;padding:0}.chk li{padding:.35rem 0 .35rem 1.9rem;position:relative}.chk li:before{content:"";position:absolute;left:0;top:.6rem;width:1.1rem;height:1.1rem;border:2px solid #111;border-radius:4px}
.faq details{border-bottom:1px solid #eee;padding:.7rem 0}.faq summary{font-weight:700;cursor:pointer}
.close{background:#111;color:#fff;border-radius:16px;padding:1.6rem 1.4rem;margin:2.6rem 0 1rem;text-align:center}.close h2{margin:0 0 .4rem;color:#fff}.close p{color:#ddd;margin:0 0 1rem}
.rail{display:none}@media(min-width:900px){.rail{display:block}.rail .in{position:sticky;top:4.8rem;border:1px solid #eee;border-radius:14px;padding:1.2rem;display:grid;gap:.7rem}.rail .btn{width:100%}.rail p{margin:0;font-size:.92rem;color:#444}.rail .toc{border:0;padding:0;margin:0;font-size:.9rem}}
.bar{position:fixed;left:0;right:0;bottom:0;padding:.6rem .8rem calc(.6rem + env(safe-area-inset-bottom));background:#fff;border-top:1px solid #e5e5e5;z-index:6}.bar .btn{display:block;width:100%}
@media(min-width:900px){.bar{display:none}}@media(max-width:899px){body.hasbar{padding-bottom:4.6rem}}
footer{border-top:1px solid #eee;margin-top:2rem;padding:2rem 1.1rem;background:#fafafa}footer .in{max-width:1120px;margin:0 auto;display:grid;gap:1.2rem}
.nl{display:flex;gap:.5rem;flex-wrap:wrap;max-width:30rem}.nl input[type=email]{flex:1 1 14rem;width:auto}footer .links{display:flex;gap:1.2rem;font-size:.95rem}footer small{color:#777}
.ph{background:#fff3cd;border:1px dashed #d4a72c;color:#6b4e00;padding:.05rem .35rem;border-radius:4px;font-weight:600}
.cards{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));padding:0;list-style:none}.card{border:1px solid #e8e8e8;border-radius:14px;padding:1rem 1.1rem}.card a.t{font-weight:700;color:#111;text-decoration:none;font-size:1.08rem;line-height:1.3;display:block;margin-bottom:.35rem}.card p{margin:.3rem 0;font-size:.93rem;color:#444}
.tags{display:flex;flex-wrap:wrap;gap:.35rem;margin:.4rem 0}.tag{font-size:.78rem;background:#f1f1f1;border-radius:999px;padding:.12rem .55rem;color:#333;border:1px solid transparent;cursor:pointer;font-family:inherit}.tag[aria-pressed=true]{background:#111;color:#fff}
.find{display:grid;gap:.6rem;margin:1rem 0}.find input{font:inherit;padding:.65rem .85rem;border:1px solid #ccc;border-radius:10px;max-width:28rem}
.hero{text-align:center;padding:2.5rem 0 1rem}.hero p{font-size:1.15rem;color:#444;max-width:40rem;margin:.3rem auto 1.2rem}.price{color:#555;font-size:.95rem;margin-top:.6rem}
section.blk{max-width:820px;margin:0 auto;width:100%}section.blk h2{margin-top:.5rem}.nums{display:flex;gap:1rem;flex-wrap:wrap}.nums div{border:1px solid #eee;border-radius:12px;padding:.8rem 1.1rem;min-width:9rem}.nums b{display:block;font-size:1.6rem}.nums small{color:#666}`;

const SCRIPT = `(function(){var K='jm_email';
function rem(){var v='';try{v=localStorage.getItem(K)||''}catch(e){}if(!v){var m=document.cookie.match(/(?:^|; )jm_email=([^;]*)/);if(m)v=decodeURIComponent(m[1])}return v}
function keep(v){try{v?localStorage.setItem(K,v):localStorage.removeItem(K)}catch(e){}if(!v)document.cookie='jm_email=; Max-Age=0; Path=/; Secure; SameSite=Lax'}
function save(r){var cd=r.headers.get('Content-Disposition')||'',m=/filename="([^"]+)"/.exec(cd);return r.blob().then(function(b){var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=m?m[1]:'download';document.body.appendChild(a);a.click();setTimeout(function(){URL.revokeObjectURL(a.href);a.remove()},4000)})}
function send(f,data){var e=f.querySelector('.err');e.textContent='';var b=f.querySelector('button[type=submit]');b.disabled=true;
return fetch(f.action,{method:'POST',body:data,headers:{'X-Guide-JS':'1'}}).then(function(r){b.disabled=false;
if(r.ok){keep(data.get('email'));var d=f.closest('details');if(d)d.open=false;paint();return save(r)}
return r.json().catch(function(){return{}}).then(function(j){if(j.need==='terms'){keep('');paint();var d=f.closest('details');if(d)d.open=true}
e.textContent=j.error||'Something went wrong. Please try again.';if(j.suggestion){var i=f.querySelector('input[type=email]');i.value=j.suggestion;f.dataset.sug=j.suggestion}})}).catch(function(){b.disabled=false;e.textContent='Network problem. Please try again.'})}
function paint(){var v=rem();document.querySelectorAll('details.dl').forEach(function(d){var w=d.querySelector('.who');if(w){w.hidden=!v;w.querySelector('b').textContent=v}})}
document.querySelectorAll('details.dl').forEach(function(d){var f=d.querySelector('form');
d.querySelector('summary').addEventListener('click',function(ev){var v=rem();if(!v)return;ev.preventDefault();var fd=new FormData();fd.set('email',v);fd.set('remembered','1');fd.set('file',f.elements.file.value);send(f,fd)});
f.addEventListener('submit',function(ev){ev.preventDefault();var fd=new FormData(f);if(f.dataset.sug&&fd.get('email')!==f.dataset.sug)fd.set('keep','1');send(f,fd)});
var no=d.querySelector('.who a');if(no)no.addEventListener('click',function(ev){ev.preventDefault();keep('');paint();d.open=true})});
document.querySelectorAll('form.nl').forEach(function(f){f.addEventListener('submit',function(ev){ev.preventDefault();fetch(f.action,{method:'POST',body:new FormData(f),headers:{'X-Guide-JS':'1'}}).then(function(r){return r.json().catch(function(){return{}}).then(function(j){f.outerHTML='<p>'+(r.ok?'Thanks, you are on the list.':(j.error||'Something went wrong.'))+'</p>'})})})});
var q=document.getElementById('q');if(q){var on='';function run(){var s=q.value.trim().toLowerCase();document.querySelectorAll('.cards .card').forEach(function(c){c.hidden=!((!s||c.dataset.text.indexOf(s)>=0)&&(!on||(' '+c.dataset.topic+' ').indexOf(' '+on+' ')>=0))})}
q.addEventListener('input',run);document.querySelectorAll('.find .tag').forEach(function(t){t.addEventListener('click',function(){on=on===t.dataset.topic?'':t.dataset.topic;document.querySelectorAll('.find .tag').forEach(function(x){x.setAttribute('aria-pressed',String(x.dataset.topic===on))});run()})});document.querySelector('.find').hidden=false}
paint()})();`;

function page({ title, description, url, image, noindex, body, from = '', bar = true }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">${noindex ? '<meta name="robots" content="noindex">' : ''}
<link rel="canonical" href="${esc(url)}"><meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(url)}">${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '<meta name="twitter:card" content="summary">'}
<style>${CSS}</style></head><body${bar ? ' class="hasbar"' : ''}>
<header class="top"><a class="brand" href="/lab">Jon Mac</a><nav><a href="/guides">Guides</a><a class="btn sm" href="${skoolHref(from, 'top')}">Join ${GROUP}</a></nav></header>
${body}
<footer><div class="in"><div><strong>New guides by email</strong>
<form class="nl" method="post" action="/guides/newsletter"><input type="hidden" name="from" value="${esc(from)}"><input type="email" name="email" placeholder="you@example.com" aria-label="Email" autocomplete="email" required maxlength="254"><button class="btn dark" type="submit">Subscribe</button></form>
<small>One email when a new guide is out. Unsubscribe any time.</small></div>
<div class="links"><a href="/guides">All guides</a><a href="/lab">Home</a><a href="/guides/terms">Terms</a></div></div></footer>
${bar ? `<div class="bar"><a class="btn" href="${skoolHref(from, 'bar')}">Join ${GROUP}, ${PRICE}</a></div>` : ''}
<script>${SCRIPT}</script></body></html>`;
}

const joinCard = (slug, pos) => `<p><strong>${GROUP}</strong><br>${esc(TAGLINE)}</p><a class="btn" href="${skoolHref(slug, pos)}">Join ${GROUP}, ${PRICE}</a>`;

export function guidePage(g, origin) {
  const slug = g.slug;
  const sections = Array.isArray(g.sections) ? g.sections : [];
  const sid = (s, i) => (/^[a-z][\w-]{0,40}$/i.test(s.id || '') ? s.id : `s${i + 1}`);
  const res = g.resource && Array.isArray(g.resource.files) && g.resource.files.length ? g.resource : null;
  const checklist = Array.isArray(g.checklist) ? g.checklist.filter(Boolean) : [];
  const faq = Array.isArray(g.faq) ? g.faq.filter((x) => x && x.q && x.a) : [];
  const summary = (Array.isArray(g.summary) ? g.summary : [g.summary]).filter(Boolean).slice(0, 3);
  const toc = [...sections.map((s, i) => [sid(s, i), s.heading]), ...(res ? [['resource', `Get the ${res.title || 'file'}`]] : []),
    ...(checklist.length ? [['checklist', 'Checklist']] : []), ...(faq.length ? [['faq', 'Common questions']] : [])];
  const tocHtml = `<nav class="toc" aria-label="Contents"><strong>Contents</strong><ol>${toc.map(([id, h]) => `<li><a href="#${esc(id)}">${esc(h)}</a></li>`).join('')}</ol></nav>`;
  const yt = /^[\w-]{11}$/.test(g.youtube_id || '') ? g.youtube_id : null;
  const firstImg = sections.find((s) => FILE_RE.test(s.image || ''))?.image;
  const image = firstImg ? `${origin}/guides/${slug}/${firstImg}` : yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
  const files = res ? res.files.filter((f) => FILE_RE.test(f)) : [];
  const dl = (f, i) => `<details class="dl"><summary class="btn dark">Download ${esc(files.length > 1 ? f.split('/').pop() : (res.title || 'the file'))}</summary>
<div class="box"><form method="post" action="/guides/${slug}/download"><input type="hidden" name="file" value="${i}">
<strong>Where should we send it?</strong><input type="email" name="email" placeholder="you@example.com" aria-label="Email" autocomplete="email" required maxlength="254">
<label><input type="checkbox" name="terms" value="1" required> I agree to the <a href="/guides/terms" target="_blank">Terms</a>.</label>
<label><input type="checkbox" name="newsletter" value="1"> Yes, email me new guides from Jon Mac. Optional; unsubscribe any time.</label>
<p class="err" role="alert"></p><button class="btn" type="submit">Get the file</button></form></div>
<p class="who" hidden>Downloads go to <b></b>. <a href="#">Not you?</a></p></details>`;
  const body = `<div class="wrap g"><article>
<p class="meta">${esc(g.read_minutes ? `${g.read_minutes} min read` : '')}${g.read_minutes && g.updated ? ' · ' : ''}${esc(fmtDate(g.updated))}</p>
<h1>${esc(g.title)}</h1>
${summary.length ? `<div class="sum"><strong>What you get</strong><ul>${summary.map((s) => `<li>${inline(s, slug)}</li>`).join('')}</ul></div>` : ''}
${yt ? `<div class="vid"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(g.title)}" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>` : ''}
${toc.length ? tocHtml : ''}
${sections.map((s, i) => `<section><h2 id="${esc(sid(s, i))}">${esc(s.heading)}</h2>${FILE_RE.test(s.image || '') ? `<figure><img src="/guides/${slug}/${esc(s.image)}" alt="${esc(s.image_alt || s.heading)}" loading="${i ? 'lazy' : 'eager'}"></figure>` : ''}${md(s.body_md, slug)}</section>`).join('\n')}
${res ? `<section class="res" id="resource"><div class="k">Free ${esc(res.type || 'file')}</div><h2>${esc(res.title || 'The file from the video')}</h2>
${res.what_it_does ? `<p>${inline(res.what_it_does, slug)}</p>` : ''}${res.how_to_use ? `<p><strong>How to use it:</strong> ${inline(res.how_to_use, slug)}</p>` : ''}${files.map(dl).join('')}</section>` : ''}
${checklist.length ? `<section><h2 id="checklist">Checklist</h2><ul class="chk">${checklist.map((c) => `<li>${inline(c, slug)}</li>`).join('')}</ul></section>` : ''}
${faq.length ? `<section class="faq"><h2 id="faq">Common questions</h2>${faq.map((f) => `<details><summary>${esc(f.q)}</summary>${md(f.a, slug)}</details>`).join('')}</section>` : ''}
<div class="close"><h2>${esc(g.closing?.headline || `Learn this with ${GROUP}`)}</h2><p>${esc(g.closing?.line || TAGLINE)}</p><a class="btn" href="${skoolHref(slug, 'end')}">Join ${GROUP}, ${PRICE}</a></div>
</article><aside class="rail"><div class="in">${joinCard(slug, 'rail')}${toc.length ? tocHtml : ''}</div></aside></div>`;
  return page({ title: g.title, description: summary.join(' ').slice(0, 300) || TAGLINE, url: `${origin}/guides/${slug}`, image, noindex: g.state !== 'listed', body, from: slug });
}

export function indexPage(list, origin) {
  const topics = [...new Set(list.flatMap((g) => (Array.isArray(g.topic) ? g.topic : [])).filter((t) => /^[\w-]{1,40}$/.test(t)))].sort();
  const cards = list.map((g) => {
    const t = (Array.isArray(g.topic) ? g.topic : []).filter((x) => topics.includes(x));
    const sum = (Array.isArray(g.summary) ? g.summary : [g.summary]).filter(Boolean);
    return `<li class="card" data-topic="${esc(t.join(' '))}" data-text="${esc(`${g.title} ${sum.join(' ')} ${t.join(' ')}`.toLowerCase())}">
<a class="t" href="/guides/${g.slug}">${esc(g.title)}</a><p>${esc(sum[0] || '')}</p>
<div class="tags">${t.map((x) => `<span class="tag">${esc(x)}</span>`).join('')}</div><p class="meta">${esc(g.read_minutes ? `${g.read_minutes} min read · ` : '')}${esc(fmtDate(g.updated))}</p></li>`;
  }).join('');
  const body = `<div class="wrap"><div><h1>Free guides</h1><p class="meta">Every guide from Jon's videos, written out with the files. Free to read.</p>
${list.length > 1 ? `<div class="find" hidden><input id="q" type="search" placeholder="Search guides" aria-label="Search guides">${topics.length ? `<div class="tags">${topics.map((t) => `<button type="button" class="tag" data-topic="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join('')}</div>` : ''}</div>` : ''}
${list.length ? `<ul class="cards">${cards}</ul>` : '<p>The first guides are on their way.</p>'}</div></div>`;
  return page({ title: 'Free guides | Jon Mac', description: `Free written guides from Jon Mac's videos, with the files. ${TAGLINE}`, url: `${origin}/guides`, body });
}

// The home page (spec 2c): only blocks with real material. [JON: ...] marks what Jon still has to supply.
export function homePage(list, origin) {
  const ph = (t) => `<span class="ph">[JON: ${esc(t)}]</span>`;
  const guides = list.slice(0, 6);
  const body = `<div class="wrap">
<section class="hero"><h1>${ph('one line, same on YouTube, Skool and here')}</h1><p>${esc(TAGLINE)}</p>
<a class="btn" href="${skoolHref('', 'home')}">Join ${GROUP}, ${PRICE}</a><div class="price">${GROUP} on Skool · ${PRICE}</div></section>
<section class="blk"><h2>What's inside</h2><p>${ph('the classroom and the files members get, in a few short lines')}</p></section>
<section class="blk"><h2>Curriculum</h2><p>${ph('the stages, in order')}</p></section>
${guides.length ? `<section class="blk"><h2>Free guides</h2><ul class="cards">${guides.map((g) => `<li class="card"><a class="t" href="/guides/${g.slug}">${esc(g.title)}</a><p>${esc((Array.isArray(g.summary) ? g.summary[0] : g.summary) || '')}</p></li>`).join('')}</ul><p><a href="/guides">All guides</a></p></section>` : ''}
<section class="blk"><h2>In numbers</h2><div class="nums"><div><b>${MEMBERS.count}</b><small>members on Skool, ${esc(fmtDate(MEMBERS.asOf))}</small></div>${list.length ? `<div><b>${list.length}</b><small>free guides</small></div>` : ''}</div></section>
<section class="blk"><h2>Your teacher</h2><p>${ph('who Jon is and his real credentials')}</p></section>
<section class="blk faq"><h2>Questions</h2><details><summary>How much is it?</summary><p>${PRICE}, paid on Skool.</p></details>
<details><summary>Where is the group?</summary><p>On Skool: ${GROUP}. The join button takes you to its about page.</p></details></section>
<section class="blk"><div class="close"><h2>${GROUP}</h2><p>${esc(TAGLINE)}</p><a class="btn" href="${skoolHref('', 'home')}">Join ${GROUP}, ${PRICE}</a></div></section>
</div>`;
  return page({ title: `${GROUP} | Jon Mac`, description: TAGLINE, url: `${origin}/lab`, body });
}

function termsPage(origin) {
  const body = `<div class="wrap"><article><h1>Terms for free downloads</h1><p><span class="ph">[JON: the terms a visitor agrees to when downloading a free file]</span></p>
<p>We keep your email to send you the file you asked for. We email you new guides only if you ticked that box, and you can unsubscribe any time.</p></article></div>`;
  return page({ title: 'Terms | Jon Mac', description: 'Terms for free downloads from Jon Mac guides.', url: `${origin}/guides/terms`, noindex: true, body, bar: false });
}

// ---- Email + file
async function readForm(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) return (await request.json().catch(() => null)) || {};
  if (type.includes('form')) return Object.fromEntries(await request.formData().catch(() => new FormData()));
  return {};
}
const f = (b, k) => (b[k] == null ? '' : String(b[k]).trim());
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'on' || v === 'true';
function cookieEmail(request) {
  const m = /(?:^|;\s*)jm_email=([^;]*)/.exec(request.headers.get('Cookie') || '');
  try { return m ? decodeURIComponent(m[1]).toLowerCase() : ''; } catch { return ''; }
}
const rememberCookie = (email) => `${EMAIL_COOKIE}=${encodeURIComponent(email)}; Max-Age=31536000; Path=/; Secure; SameSite=Lax`;

// Saves one email: the guide record (with the consent flags) and the shared lead list skool_leads, same row shape as /s/.
async function storeEmail(env, { slug, email, check, newsletter, terms, file }) {
  const now = iso();
  try {
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM guide_emails WHERE slug = ? AND at >= ?').bind(slug, iso(Date.now() - 600e3)).first();
    if ((recent?.n || 0) >= MAX_EMAILS_PER_10_MIN) return false;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO guide_emails (slug, email, newsletter, terms, file, at) VALUES (?, ?, ?, ?, ?, ?)').bind(slug, email, newsletter ? 1 : 0, terms ? 1 : 0, file, now),
      env.DB.prepare(`INSERT INTO skool_leads (slug, email, at, email_check, last_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(slug, email) DO UPDATE SET last_at = excluded.last_at, email_check = excluded.email_check`).bind(slug, email, now, check, now),
    ]);
    return true;
  } catch (err) { console.error('guide email save failed', slug, err.message); return false; } // never the email
}

function formError(js, status, error, extra = {}) {
  if (js) return json({ error, ...extra }, status);
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Check your email</title><style>${CSS}</style></head>
<body><div class="wrap"><article><h1>One more thing</h1><p class="err">${esc(error)}</p><p><a href="javascript:history.back()">Go back</a></p></article></div></body></html>`, { status, index: false });
}

async function download(request, env, ctx, slug) {
  const g = await loadGuide(env, slug);
  if (!g) return json({ error: 'No such guide' }, 404);
  const files = (g.resource?.files || []).filter((x) => FILE_RE.test(x));
  const b = await readForm(request);
  const idx = Number.parseInt(f(b, 'file') || '0', 10);
  const file = files[Number.isFinite(idx) ? idx : 0];
  if (!file) return json({ error: 'No file' }, 404);
  const js = request.headers.get('X-Guide-JS') === '1';
  const check = authed(request, env); // MacFrames' publish check: the file, nothing stored or counted
  let setCookie = null;
  if (!check) {
    let email = f(b, 'email').toLowerCase() || cookieEmail(request);
    const remembered = truthy(b.remembered) || (!f(b, 'email') && !!email);
    if (!email) return formError(js, 400, 'Please enter your email.');
    let terms = truthy(b.terms), newsletter = truthy(b.newsletter);
    if (remembered && !terms) {
      // One click for a returning visitor: only if this email already agreed to the Terms on some guide.
      const seen = await env.DB.prepare('SELECT MAX(terms) AS t, MAX(newsletter) AS n FROM guide_emails WHERE email = ?').bind(email).first().catch(() => null);
      if (!seen?.t) return formError(js, 400, 'Please enter your email and tick the Terms box.', { need: 'terms' });
      terms = true; newsletter = false; // a one-click download never adds newsletter consent
    }
    if (!terms) return formError(js, 400, 'Please tick the Terms box to get the file.');
    const res = await checkEmail(email, { keepTypo: truthy(b.keep) });
    if (!res.ok) return formError(js, 400, res.message, res.reason === 'typo' ? { suggestion: res.suggestion } : {});
    email = res.email;
    if (await storeEmail(env, { slug, email, check: res.check, newsletter, terms, file })) count(env, ctx, slug, 'download');
    setCookie = rememberCookie(email);
  }
  const obj = env.UPLOADS ? await env.UPLOADS.get(`guides/${slug}/${file}`) : null;
  if (!obj) return formError(js, 404, 'That file is missing. Please try again later.');
  const name = file.split('/').pop();
  const headers = new Headers({ 'Content-Type': TYPES[ext(name)] || 'application/octet-stream', 'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' });
  if (setCookie) headers.set('Set-Cookie', setCookie);
  return new Response(obj.body, { status: 200, headers });
}

async function newsletter(request, env) {
  const js = request.headers.get('X-Guide-JS') === '1';
  const b = await readForm(request);
  const from = f(b, 'from').toLowerCase();
  const slug = SLUG_RE.test(from) ? from : 'guides';
  const res = await checkEmail(f(b, 'email'), { keepTypo: truthy(b.keep) });
  if (!res.ok) return formError(js, 400, res.message, res.reason === 'typo' ? { suggestion: res.suggestion } : {});
  await storeEmail(env, { slug, email: res.email, check: res.check, newsletter: true, terms: false, file: null });
  if (js) return json({ ok: true });
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Thanks</title><style>${CSS}</style></head>
<body><div class="wrap"><article><h1>Thanks, you are on the list.</h1><p><a href="${slug === 'guides' ? '/guides' : `/guides/${slug}`}">Back to the guide</a></p></article></div></body></html>`, { index: false });
}

async function serveImage(env, slug, name) {
  const obj = env.UPLOADS && SLUG_RE.test(slug) && /^[A-Za-z0-9][\w.-]{0,99}$/.test(name) && /^(png|jpe?g|webp|gif)$/.test(ext(name)) ? await env.UPLOADS.get(`guides/${slug}/img/${name}`) : null;
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, { headers: { 'Content-Type': TYPES[ext(name)], 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' } });
}

// ---- Publish (MacFrames)
function b64bytes(s) {
  const bin = atob(String(s).replace(/^data:[^,]*,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function validateGuide(g, slug) {
  if (!g || typeof g !== 'object') return 'guide is required';
  if (g.slug && g.slug !== slug) return 'guide.slug must match the address';
  if (typeof g.title !== 'string' || !g.title.trim() || g.title.length > 200) return 'title is required (200 characters max)';
  if (g.state && !['listed', 'unlisted'].includes(g.state)) return 'state must be listed or unlisted';
  if (g.youtube_id != null && !/^[\w-]{11}$/.test(g.youtube_id)) return 'youtube_id must be an 11-character video ID or null';
  if (g.updated && !/^\d{4}-\d{2}-\d{2}$/.test(g.updated)) return 'updated must be YYYY-MM-DD';
  if (!Array.isArray(g.sections) || !g.sections.length) return 'sections must be a non-empty list';
  for (const s of g.sections) {
    if (!s || typeof s.heading !== 'string' || typeof s.body_md !== 'string') return 'every section needs heading and body_md';
    if (s.image && !/^img\//.test(s.image)) return `section image must be under img/: ${s.image}`;
  }
  for (const p of g.resource?.files || []) if (!FILE_RE.test(p) || !p.startsWith('resource/')) return `resource file must be resource/<name>: ${p}`;
  return '';
}
async function publish(request, env, slug) {
  if (!authed(request, env)) return json({ error: 'Unauthorized' }, 401);
  if (!SLUG_RE.test(slug) || NOT_SLUGS.has(slug)) return json({ error: 'Bad slug' }, 400);
  const b = await request.json().catch(() => null);
  const g = b?.guide;
  const why = validateGuide(g, slug);
  if (why) return json({ error: why }, 400);
  const files = b.files && typeof b.files === 'object' ? b.files : {};
  for (const [p, data] of Object.entries(files)) {
    if (!FILE_RE.test(p)) return json({ error: `Bad file path: ${p}` }, 400);
    let bytes;
    try { bytes = b64bytes(data); } catch { return json({ error: `Not base64: ${p}` }, 400); }
    await env.UPLOADS.put(`guides/${slug}/${p}`, bytes, { httpMetadata: { contentType: TYPES[ext(p)] || 'application/octet-stream' } });
  }
  const needed = [...(g.resource?.files || []), ...g.sections.map((s) => s.image).filter(Boolean)];
  const missing = [];
  for (const p of needed) if (!(await env.UPLOADS.head(`guides/${slug}/${p}`))) missing.push(p);
  if (missing.length) return json({ error: 'Files missing', missing }, 400);
  const state = g.state === 'listed' ? 'listed' : 'unlisted';
  const updated = g.updated || iso().slice(0, 10);
  const doc = { ...g, slug, state, updated };
  await env.DB.prepare(`INSERT INTO guides (slug, title, state, updated, json, published_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET title = excluded.title, state = excluded.state, updated = excluded.updated, json = excluded.json, published_at = excluded.published_at`)
    .bind(slug, g.title.trim(), state, updated, JSON.stringify(doc), iso()).run();
  return json({ ok: true, slug, state, url: `${new URL(request.url).origin}/guides/${slug}` });
}

// ---- Entry points
export async function handleGuides(request, env, ctx) {
  const url = new URL(request.url);
  const origin = url.origin;
  const parts = url.pathname.replace(/\/+$/, '').split('/').slice(2); // after /guides
  const m = request.method;
  if (parts[0] === 'api') {
    const slug = (parts[1] || '').toLowerCase();
    if (parts.length === 2 && m === 'PUT') return publish(request, env, slug);
    if (parts.length === 3 && parts[2] === 'stats' && m === 'GET') {
      if (!authed(request, env)) return json({ error: 'Unauthorized' }, 401);
      return json(await guideStats(env.DB, slug));
    }
    return json({ error: 'Not found' }, 404);
  }
  if (!parts.length) return ['GET', 'HEAD'].includes(m) ? html(indexPage(await listed(env), origin)) : json({ error: 'Method not allowed' }, 405);
  if (parts.length === 1 && parts[0] === 'terms') return html(termsPage(origin), { index: false });
  if (parts.length === 1 && parts[0] === 'newsletter') return m === 'POST' ? newsletter(request, env) : new Response(null, { status: 302, headers: { Location: '/guides' } });
  const slug = parts[0].toLowerCase();
  if (parts.length === 2 && parts[1] === 'download' && m === 'POST') return download(request, env, ctx, slug);
  if (parts.length === 3 && parts[1] === 'img' && ['GET', 'HEAD'].includes(m)) return serveImage(env, slug, parts[2]);
  if (parts.length !== 1 || !['GET', 'HEAD'].includes(m)) return new Response('Not found', { status: 404 });
  const g = await loadGuide(env, slug);
  if (!g) return html(page({ title: 'Guide not found | Jon Mac', description: 'This guide is not here.', url: `${origin}/guides`, noindex: true, body: '<div class="wrap"><article><h1>Guide not found</h1><p><a href="/guides">See all guides</a></p></article></div>' }), { status: 404, index: false });
  if (m === 'GET' && !url.searchParams.has('qc')) count(env, ctx, slug, 'visit');
  return html(guidePage(g, origin), { index: g.state === 'listed' });
}

export async function handleGo(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== '/go/skool' || !['GET', 'HEAD'].includes(request.method)) return new Response('Not found', { status: 404 });
  const from = (url.searchParams.get('from') || '').toLowerCase();
  const pos = url.searchParams.get('pos') || '';
  if (request.method === 'GET' && !url.searchParams.has('qc')) count(env, ctx, SLUG_RE.test(from) ? from : null, 'skool', POS.has(pos) ? pos : 'other');
  return new Response(null, { status: 302, headers: { Location: SKOOL_ABOUT, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export async function handleLab(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  return html(homePage(await listed(env), new URL(request.url).origin));
}

// /s/<slug> (and root slugs) with GUIDES_S_SWITCH on: count the click the way /s/ always has, then show the guide, or /lab.
export async function guideEntry(request, env, ctx, slug) {
  const url = new URL(request.url);
  const counting = request.method === 'GET' && !url.searchParams.has('qc');
  if (counting && env.DB) {
    let link = null;
    try { link = await env.DB.prepare('SELECT slug FROM skool_links WHERE slug = ?').bind(slug).first(); } catch { /* unknown */ }
    if (link) {
      let ref = null;
      try { const r = new URL(request.headers.get('Referer') || ''); ref = (r.host + r.pathname).slice(0, 200); } catch { /* none */ }
      const country = typeof request.cf?.country === 'string' ? request.cf.country.slice(0, 2) : null;
      ctx.waitUntil(env.DB.prepare('INSERT INTO skool_clicks (slug, at, referrer, country) VALUES (?, ?, ?, ?)')
        .bind(slug, iso(), ref, country).run().catch((err) => console.error('skool click', err)));
    }
  }
  const g = await loadGuide(env, slug);
  if (!g) return handleLab(request, env);
  if (counting) count(env, ctx, slug, 'visit');
  return html(guidePage(g, url.origin), { index: false }); // the guide's own address is the indexed one
}
