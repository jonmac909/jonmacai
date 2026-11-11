// Dashboard 3 Review page (docs/dashboard-3.md), laid out as the approved design (Review.dc.html): a queue on the left,
// one item at a time on the right. Items: Florence's sponsor reply drafts (from d2's Sponsors board) and d3.queue
// (cards in Review, pending approvals, open questions). Every button calls a write the dashboard already has, and only
// on Jon's click:
//   card      Approve = PATCH /v1/tasks/:id {status: done}; Send back = PATCH {status: doing, comment}
//             (a video with a review page only links there: approving it on that page locks the version)
//   approval  Approve / Reject = POST /v1/approvals/:id/decide
//   question  pick an option, or Other and type, then Submit = POST /v1/questions/:id/answer
// Each write asks Jon to confirm first and goes to the item its button was drawn for.
//   email     Send = POST /dashboard/api/actions {kind: the draft's sendKind}; Edit first edits the draft in place
//             Above the draft sits the Gmail thread it replies to (GET /dashboard/api/sponsor-threads, read only, found by
//             the card's Gmail thread id): messages oldest first, the newest two open, older ones folded, then "Your reply".
// Undo has nothing to call yet, so it shows disabled.
import { esc, icon, draftsOf } from './util.js';
import { headerOnly } from './goals.js';

const IC = {
  video: '<path d="M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3zM10 9l5 3-5 3z"></path>',
  email: '<path d="M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 7l9 6 9-6"></path>',
  decision: '<path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5M12 16.5h.01"></path>',
};
const ICON_OF = { video: 'video', card: 'decision', approval: 'decision', question: 'decision', email: 'email' };
const svg = (k) => `<svg class="ic" aria-hidden="true" viewBox="0 0 24 24">${IC[ICON_OF[k]] || IC.decision}</svg>`;
const safeHref = (h) => (/^(https?:\/\/|\/(?![/\\]))/i.test(String(h || '')) ? String(h) : '');

// Videos waiting for Jon first, then sponsor drafts (Jon's priority 1), then the rest; dev cards last (d3.queue's order).
// null when neither source could be read.
export function reviewItems(d2resp, d3resp) {
  const live = d3resp?.d3?.queue;
  const drafts = draftsOf(d2resp);
  if (!Array.isArray(live) && !drafts) return null;
  const mail = (drafts || []).map((k) => ({
    id: `d:${k.id}`, type: 'email', group: 'other', kind: 'Sponsor email', name: k.name || 'Sponsor', head: `Reply to ${k.name || 'sponsor'}`,
    sub: [k.column, 'your send'].filter(Boolean).join(' · '),
    facts: [{ l: 'To', v: k.payload.to || '–' }, { l: 'Subject', v: k.payload.subject || '–' }, { l: 'Stage', v: k.column || '–' }],
    body: k.payload.body || '', threadId: k.threadId || '', act: { type: 'email', payload: k.payload },
  }));
  const rest = Array.isArray(live) ? live : [];
  const vids = rest.filter((x) => x.group === 'video');
  return [...vids, ...mail, ...rest.filter((x) => x.group !== 'video')];
}

const GROUPS = [['video', 'Videos for you'], ['other', 'Emails, approvals, questions and cards'], ['dev', 'Dev cards']];
const groupOf = (x) => (x.group === 'video' || x.group === 'dev' ? x.group : 'other');
const RANK = { video: 0, other: 1, dev: 2 };
const isDevCard = (c) => c.group === 'dev' && c.act?.type === 'card';

// The queue as shown: live items plus the ones Jon finished this visit (kept with their done label until he leaves),
// in the left list's group order so previous / next follow it.
function shown(items, ui) {
  const kept = Object.values(ui.rvKept || {}).filter((k) => !items.some((x) => x.id === k.id));
  return [...items, ...kept].sort((a, b) => RANK[groupOf(a)] - RANK[groupOf(b)]);
}

// A video with a review page is approved or sent back there, so the review app locks that version (VIDEO.md).
const reviewPage = (c) => c.type === 'video' && /\/dashboard\/review\//i.test(safeHref(c.link));
const OTHER = /^other\s*\(type/i; // "Other (type your own)": opens the typed box, never sent as the answer
export const OTHER_PICK = '\u0000other'; // the pick that means "the typed box", never equal to a real option
// Which buttons each item type takes; a click on any other is ignored.
const ALLOWED = { card: ['approve', 'open-back', 'cancel', 'back', 'done'], approval: ['yes', 'no'], question: ['pick', 'other', 'answer'], email: ['send', 'edit'] };

function buttons(c, ui) {
  const busy = ui.busy ? ' disabled' : '';
  const a = c.act || {};
  if (ui.rvDone?.[c.id]) {
    return `<span class="pill ok" style="padding: 8px 14px; font-size: 13px">${esc(ui.rvDone[c.id])}</span><button type="button" class="btn lg" disabled title="Nothing to undo with yet">Undo</button>`;
  }
  // Every action button names the item it was drawn for, so a refresh in between can never move the click.
  const btn = (rv, label, pri, extra = '') => `<button type="button" class="btn${pri ? ' pri' : ''} lg" data-rv="${rv}" data-id="${esc(c.id)}"${extra}${busy}>${esc(label)}</button>`;
  const box = (ph, label) => `<div class="stack" style="flex: 1 1 100%; gap: 8px"><textarea class="rvtext" rows="3" maxlength="4000" placeholder="${esc(ph)}" aria-label="${esc(ph)}">${esc(ui.rvText || '')}</textarea>
<div class="hd" style="gap: 10px; flex-wrap: wrap">${label === 'Send back' ? `${btn('back', 'Send back', true)}${btn('cancel', 'Cancel')}` : btn('answer', label, true)}</div></div>`;
  if (a.type === 'card') {
    if (reviewPage(c)) return `<a class="btn pri lg" href="${esc(safeHref(c.link))}" target="_blank" rel="noopener">Approve or send back on the review page</a>`;
    if (ui.rvBack === c.id) return box('What should change', 'Send back');
    if (isDevCard(c)) return `${btn('done', 'Done', true)}${btn('open-back', 'Send back')}`;
    return `${btn('approve', 'Approve', true)}${btn('open-back', 'Send back')}`;
  }
  if (a.type === 'approval') return `${btn('yes', 'Approve', true)}${btn('no', 'Reject')}`;
  if (a.type === 'question') {
    // Pick one option (the bot's order, recommended first) or "Other (type your own)", then one Submit.
    // A question with no options shows only the box. The pick belongs to this item, so paging away drops it.
    const opts = (a.options || []).filter((o) => !OTHER.test(o));
    const pick = ui.rvPick?.id === c.id ? ui.rvPick.v : null;
    const other = !opts.length || pick === OTHER_PICK;
    const choice = (rv, label, on, extra = '') => `<button type="button" class="btn lg" data-rv="${rv}" data-id="${esc(c.id)}" aria-pressed="${on}"${extra}${busy}>${esc(label)}</button>`;
    const choices = opts.length
      ? `<div class="hd" role="group" aria-label="Answers" style="gap: 10px; flex-wrap: wrap; flex: 1 1 100%">${opts.map((o) => choice('pick', o, pick === o, ` data-opt="${esc(o)}"`)).join('')}${choice('other', 'Other (type your own)', other)}</div>`
      : '';
    const typed = other ? `<textarea class="rvtext" rows="3" maxlength="4000" placeholder="Type your answer" aria-label="Type your answer" style="flex: 1 1 100%">${esc(ui.rvText || '')}</textarea>` : '';
    return `${choices}${typed}${btn('answer', 'Submit', true)}`;
  }
  if (a.type === 'email') return `${btn('send', 'Send', true)}${btn('edit', 'Edit first', false, ` aria-pressed="${ui.rvEdit === c.id}"`)}`;
  return '';
}

// The email thread a sponsor draft replies to, oldest first (ui.rvThreads = GET /dashboard/api/sponsor-threads).
// The newest two messages start open, older ones folded; a click opens or folds one (kept in ui.rvOpen across refreshes).
const when = (iso) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};
function threadHtml(c, ui) {
  const T = ui.rvThreads;
  const box = (inner) => `<div class="inner rvthread" style="gap: 8px">${inner}</div>`;
  if (!T) return box('<span class="mut">Email thread</span><span class="nf">Loading the thread</span>');
  if (T.error) return box(`<span class="mut">Email thread</span><span class="nf">Could not load the thread (${esc(T.error)})</span>`);
  const th = c.threadId && T.threads?.[c.threadId];
  if (th?.error) return box('<span class="mut">Email thread</span><span class="nf">Could not load the thread</span>');
  const msgs = th?.messages || [];
  if (!msgs.length) return box('<span class="mut">Email thread</span><span class="nf">No thread found</span>');
  const rows = msgs.map((m, j) => {
    const key = `${c.threadId}:${m.id || j}`; // by Gmail message id, so a new message keeps the others' fold state
    const open = ui.rvOpen?.[key] ?? j >= msgs.length - 2;
    return `<details class="rvmsg"${open ? ' open' : ''}><summary data-rvmsg="${esc(key)}"><b class="ell">${esc(m.from || 'Unknown sender')}</b><span class="mut" style="flex: none">${esc(when(m.date))}</span></summary>
<p class="sub" style="white-space: pre-wrap; overflow-wrap: anywhere">${m.body ? esc(m.body) : '<span class="nf">No text</span>'}${m.quoted ? '\n<span class="mut">(earlier quoted text hidden)</span>' : ''}</p></details>`;
  }).join('\n');
  return box(`<span class="mut">Email thread · ${msgs.length} message${msgs.length === 1 ? '' : 's'}, oldest first</span>\n${rows}`);
}

const factsHtml = (facts, w = 80) => `<div class="inner" style="gap: 0">${(facts || []).map((f) => `<div class="hrow"><span class="mut" style="width: ${w}px; flex: none">${esc(f.l)}</span><span class="ell">${esc(f.v)}</span></div>`).join('')}</div>`;

// The card's other proof links as buttons (video cards; other cards draw theirs inside their own box).
const proofBtns = (c) => {
  const ls = (c.links || []).filter((l) => safeHref(l.href));
  return ls.length ? `<div class="inner"><span class="mut">Proof links</span><div class="hd" style="gap: 8px; flex-wrap: wrap">${ls.map((l) => `<a class="btn" href="${esc(safeHref(l.href))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div></div>` : '';
};

function bodyHtml(c, ui) {
  if (c.type === 'video') {
    const href = safeHref(c.link);
    const player = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener" style="flex: 3 1 360px; min-width: 0; aspect-ratio: 16 / 9; border-radius: 16px; background: var(--card2); border: 1px solid var(--line); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: var(--ink2); text-decoration: none"><span class="chip" style="width: 56px; height: 56px; border-radius: 50%"><svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z"></path></svg></span><span>${esc(c.linkLabel || 'Open the video')}</span></a>`
      : '<div style="flex: 3 1 360px; min-width: 0; aspect-ratio: 16 / 9; border-radius: 16px; background: var(--card2); border: 1px solid var(--line); display: flex; align-items: center; justify-content: center"><span class="nf">No video link on the card</span></div>';
    return `<div class="row" style="gap: 16px">
${player}
<div class="stack" style="flex: 2 1 200px; gap: 12px">
<div class="inner" style="gap: 8px"><span class="mut">Thumbnail</span><div class="nf" style="aspect-ratio: 16 / 9; border-radius: 10px; background: var(--card2); display: flex; align-items: center; justify-content: center">No feed</div></div>
<div class="inner" style="gap: 4px"><span class="mut">Title</span><b>${esc(c.head)}</b></div>
<div class="inner" style="gap: 0">${(c.facts || []).map((f) => `<div class="hrow"><span class="mut">${esc(f.l)}</span><b>${esc(f.v)}</b></div>`).join('')}</div>
</div>
</div>${c.body ? `<div class="inner"><span class="mut">Card note</span><p class="sub">${esc(c.body)}</p></div>` : ''}${proofBtns(c)}`;
  }
  if (c.type === 'email') {
    if (ui.rvEdit === c.id) {
      const p = { ...c.act.payload, ...(ui.rvDraft || {}) };
      const f = (name, label, v) => `<label class="hrow"><span class="mut" style="width: 80px; flex: none">${label}</span><input class="rvin" name="${name}" value="${esc(v)}"></label>`;
      return `<div class="inner" style="gap: 6px">${f('to', 'To', p.to || '')}${f('subject', 'Subject', p.subject || '')}</div>
${threadHtml(c, ui)}
<div class="inner rvreply" style="min-height: 240px"><span class="mut">Your reply (draft, not sent)</span><textarea class="rvin" name="body" rows="12">${esc(p.body || '')}</textarea></div>`;
    }
    return `${factsHtml(c.facts)}
${threadHtml(c, ui)}
<div class="inner rvreply" style="min-height: 240px"><span class="mut">Your reply (draft, not sent)</span><p class="sub" style="white-space: pre-wrap">${c.body ? esc(c.body) : '<span class="nf">No draft text</span>'}</p></div>`;
  }
  const label = c.type === 'card' ? 'Card note' : c.type === 'approval' ? 'Notes' : 'Context';
  const links = [...(c.links || []), ...(c.link ? [{ label: c.linkLabel || 'Open', href: c.link }] : [])].filter((l) => safeHref(l.href));
  return `${factsHtml(c.facts)}
<div class="inner"${c.type === 'question' ? '' : ' style="min-height: 160px"'}><span class="mut">${label}</span><p class="sub">${c.body ? esc(c.body) : '<span class="nf">None given</span>'}</p>${links.length ? `<div class="hd" style="gap: 8px; flex-wrap: wrap">${links.map((l) => `<a class="btn" href="${esc(safeHref(l.href))}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join('')}</div>` : ''}</div>`;
}

export function renderReview(d2resp, d3resp, ui = {}) {
  const items = reviewItems(d2resp, d3resp);
  const rv = d3resp?.d3?.review;
  const vids = rv && Number.isFinite(rv.videos) ? `${rv.videos} video${rv.videos === 1 ? '' : 's'} for you · ` : '';
  const sub = rv?.count ? `${vids}One at a time · oldest has waited ${rv.oldestLabel}` : 'One at a time';
  const head = headerOnly(d2resp, 'Review', sub, '<span class="pill sp">Nothing is sent without your click</span>');
  if (!items) return `${head}<section class="card"><p class="mut">No feed: the review queue could not be read.</p></section>`;
  const q = shown(items, ui);
  const left = q.filter((x) => !ui.rvDone?.[x.id]).length;
  const i = Math.max(0, q.findIndex((x) => x.id === ui.rvSel));
  const c = q[i];
  const row = (x) => {
    const j = q.indexOf(x);
    const dev = isDevCard(x) && !ui.rvDone?.[x.id];
    // In a dev row the pick button shrinks so a long title never pushes Done out.
    const pick = `<button type="button" class="qrow"${dev ? ' style="flex: 1; min-width: 0"' : ''} aria-current="${j === i}" data-rvq="${esc(x.id)}"><span class="chip">${svg(x.type)}</span><span class="stack" style="flex: 1; min-width: 0"><b class="ell">${esc(x.name)}</b><span class="mut ell" style="font-size: 12px">${esc(x.sub)}</span></span>${ui.rvDone?.[x.id] ? `<span class="pill ok">${esc(ui.rvDone[x.id])}</span>` : ''}</button>`;
    // A dev card closes from its row in one click (Jon's ask, 2026-11-11).
    if (!dev) return pick;
    return `<div class="hd" style="gap: 6px">${pick}<button type="button" class="btn sm" style="flex: none" data-rv="done" data-id="${esc(x.id)}"${ui.busy ? ' disabled' : ''} aria-label="Done: ${esc(x.name)}">Done</button></div>`;
  };
  const list = q.length
    ? GROUPS.map(([g, label]) => {
      const rows = q.filter((x) => groupOf(x) === g);
      return rows.length ? `<h3 class="mut" style="margin: 12px 10px 4px; font-size: 13px">${label} (${rows.length})</h3>\n${rows.map(row).join('\n')}` : '';
    }).join('\n')
    : '<p class="mut" style="padding: 8px 10px">Nothing waiting for you.</p>';
  const nav = (dir, label, d) => `<button type="button" class="btn sm" style="min-width: 36px; min-height: 36px; padding: 0" aria-label="${label}" data-rvnav="${dir}"${q.length > 1 ? '' : ' disabled'}><svg class="ic" aria-hidden="true" viewBox="0 0 24 24">${d}</svg></button>`;
  const detail = c
    ? `<div class="hd cardhd"><span class="pill">${esc(c.kind)}</span><span class="mut">${i + 1} of ${q.length}</span>
<div class="hd sp" style="gap: 6px">${nav('-1', 'Previous', '<path d="M19 12H5"></path><path d="m11 6-6 6 6 6"></path>')}${nav('1', 'Next', '<path d="M5 12h14"></path><path d="m13 6 6 6-6 6"></path>')}</div>
</div>
<div class="stack" style="gap: 4px"><h1 style="font-size: 28px; overflow-wrap: anywhere">${esc(c.head)}</h1><span class="mut">${esc(c.sub)}</span></div>
${bodyHtml(c, ui)}
${ui.rvErr ? `<p class="mut" role="alert" style="color: var(--bad-ink)">${esc(ui.rvErr)}</p>` : ''}
<div class="hd" style="gap: 10px; flex-wrap: wrap">${buttons(c, ui)}</div>`
    : `<div class="hd cardhd"><span class="pill">Queue</span></div><p class="mut">Nothing waiting for you.</p>`;
  return `${head}
<div class="row rvwrap">
<section class="card rvqueue" style="flex: 1 1 250px; gap: 4px; padding: 18px 12px">
<div class="hd" style="margin: 0 10px 10px"><h2>Queue</h2><span class="pill sp">${left} left</span></div>
${list}
</section>
<section class="card rvdetail" style="flex: 3 1 520px; gap: 18px">
${detail}
</section>
</div>`;
}

// ---- clicks: pick, previous / next, and the actions. Returns true when it handled the click. ----
async function send(url, method, body) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: JSON.stringify(body) });
  const row = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(row.error || `answered ${res.status}`);
  return row;
}

export async function reviewClick(e, S, render, reload) {
  const ui = S.ui;
  const items = reviewItems(S.d2, S.d3) || [];
  const q = shown(items, ui);
  const pick = e.target.closest('[data-rvq]');
  if (pick) { Object.assign(ui, { rvSel: pick.dataset.rvq, rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '', rvErr: '' }); render(); return true; }
  const msg = e.target.closest('[data-rvmsg]');
  if (msg) {
    e.preventDefault(); // the page draws open or folded from ui.rvOpen, so a refresh keeps Jon's choice
    const k = msg.dataset.rvmsg;
    ui.rvOpen = { ...(ui.rvOpen || {}), [k]: !msg.parentElement.open };
    render();
    return true;
  }
  const nav = e.target.closest('[data-rvnav]');
  if (nav) {
    if (!q.length) return true;
    const i = Math.max(0, q.findIndex((x) => x.id === ui.rvSel));
    Object.assign(ui, { rvSel: q[(i + Number(nav.dataset.rvnav) + q.length) % q.length].id, rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '', rvErr: '' });
    render();
    return true;
  }
  const b = e.target.closest('[data-rv]');
  if (!b) return false;
  if (b.disabled || ui.busy) return true;
  const c = q.find((x) => x.id === b.dataset.id);
  if (!c) { ui.rvErr = 'This item changed since it was shown. Check it again.'; render(); await reload(); return true; }
  if (ui.rvDone?.[c.id]) return true;
  const what = b.dataset.rv;
  if (!(ALLOWED[c.act?.type] || []).includes(what) || reviewPage(c) || (what === 'done' && !isDevCard(c))) return true;
  const text = () => document.querySelector('#main .rvtext')?.value.trim() || '';
  if (what === 'open-back') { Object.assign(ui, { rvBack: c.id, rvText: '', rvErr: '' }); render(); return true; }
  if (what === 'cancel') { Object.assign(ui, { rvBack: null, rvText: '', rvErr: '' }); render(); return true; }
  if (what === 'edit') { ui.rvEdit = ui.rvEdit === c.id ? null : c.id; ui.rvDraft = {}; ui.rvErr = ''; render(); return true; }
  if (what === 'pick' || what === 'other') { ui.rvPick = { id: c.id, v: what === 'pick' ? b.dataset.opt : OTHER_PICK }; ui.rvErr = ''; render(); return true; }
  let call;
  let label;
  const a = c.act;
  if (what === 'done') {
    // One click, no confirm: a dev card in Review passed QC and Jon only closes it.
    call = () => send(a.url, 'PATCH', { status: 'done' }); label = 'Done';
  } else if (what === 'approve') {
    if (!window.confirm(`Approve "${c.head}"? It moves to Done.`)) return true;
    call = () => send(a.url, 'PATCH', { status: 'done' }); label = 'Approved';
  } else if (what === 'back') {
    const comment = text();
    if (!comment) { ui.rvErr = 'Type what should change first.'; render(); return true; }
    if (!window.confirm(`Send "${c.head}" back with your note?`)) return true;
    call = () => send(a.url, 'PATCH', { status: 'doing', comment }); label = 'Sent back';
  } else if (what === 'yes') {
    if (!window.confirm(a.confirm || `Approve "${c.head}"?`)) return true;
    call = () => send(a.url, 'POST', { decision: 'approve' }); label = 'Approved';
  } else if (what === 'no') {
    if (!window.confirm(`Reject "${c.head}"?`)) return true;
    call = () => send(a.url, 'POST', { decision: 'reject' }); label = 'Rejected';
  } else if (what === 'answer') {
    const opts = (a.options || []).filter((o) => !OTHER.test(o));
    const pick = ui.rvPick?.id === c.id ? ui.rvPick.v : null;
    const picked = opts.includes(pick) ? pick : '';
    const answer = picked || (!opts.length || pick === OTHER_PICK ? text() : '');
    if (!answer) { ui.rvErr = opts.length ? 'Pick an answer, or Other and type your own.' : 'Type an answer first.'; render(); return true; }
    if (!window.confirm(`Answer "${c.head}" with "${answer}"?`)) return true;
    call = () => send(a.url, 'POST', { answer }); label = picked || 'Answered';
  } else if (what === 'send') {
    const payload = { ...a.payload, ...(ui.rvEdit === c.id ? ui.rvDraft || {} : {}) };
    if (!String(payload.to || '').trim() || !String(payload.body || '').trim()) { ui.rvErr = 'The draft needs a recipient and text.'; render(); return true; }
    if (!window.confirm(`Send this email to ${payload.to}?`)) return true;
    // One key per draft until it goes through, so a retry after a lost answer can't send it twice.
    // Keyed by the draft's content too, so a new or edited draft gets a new key.
    ui.rvIdem = { ...(ui.rvIdem || {}) };
    const sig = JSON.stringify([c.id, payload.to, payload.subject, payload.body]);
    const idemKey = ui.rvIdem[sig] || (ui.rvIdem[sig] = crypto.randomUUID());
    call = () => send('/dashboard/api/actions', 'POST', { kind: payload.sendKind, payload, idemKey });
    label = 'Send queued';
  } else return true;
  ui.busy = true;
  ui.rvErr = '';
  render();
  try {
    const row = await call();
    if (what === 'send' && row?.status === 'done' && row.result) label = String(row.result);
    if (what === 'send') ui.rvIdem = {};
    ui.rvDone = { ...(ui.rvDone || {}), [c.id]: label };
    ui.rvKept = { ...(ui.rvKept || {}), [c.id]: c };
    // Closing a row other than the open item leaves the open item where it is.
    const open = q[Math.max(0, q.findIndex((x) => x.id === ui.rvSel))]?.id;
    if (open && open !== c.id) ui.rvSel = open;
    else {
      const next = q.find((x) => x.id !== c.id && !ui.rvDone[x.id]);
      Object.assign(ui, { rvSel: next ? next.id : c.id, rvBack: null, rvEdit: null, rvDraft: {}, rvPick: null, rvText: '' });
    }
  } catch (err) {
    ui.rvErr = `Could not save: ${err.message}`;
  }
  ui.busy = false;
  await reload();
  return true;
}
