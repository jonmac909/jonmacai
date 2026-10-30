import { URL_RE, esc, hostOf, linkify, whenLabel } from '../ui.js';

// Journal (Jon, 2026-10-30): his own links and ideas for later. One box takes a pasted link or text,
// tags optional. Only his session reads or writes it (bots get 403). #journal/<tag> filters by tag.
const API = '/dashboard/api/v1/journal';
const TAG_RE = /^[a-z0-9][a-z0-9-]{0,29}$/;

// The quick-add box: a pasted link becomes the link, the rest the title (none: the server names it after the site).
export function quickEntry(text, tags) {
  const s = String(text || '').trim();
  const link = s.match(URL_RE)?.[0] || '';
  return { title: s.replace(link, ' ').replace(/\s+/g, ' ').trim(), link, tags: String(tags || '') };
}

// A link shows as its title, any URL in that title as its site: never a raw URL.
const label = (title) => title.split(URL_RE).map((p, i) => (i % 2 ? hostOf(p) || 'link' : p)).join('');

export function entryHtml(e, now = Date.now()) {
  const host = e.link ? hostOf(e.link) : '';
  const title = e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${esc(label(e.title))}</a>` : linkify(e.title);
  const tags = (e.tags || []).map((t) => `<button type="button" class="chip jntag" data-page="journal/${esc(t)}">#${esc(t)}</button>`).join('');
  return `<li class="jnentry" data-id="${esc(e.id)}">
    <h3 class="qq">${title}${host ? ` <span class="jnhost">${esc(host)}</span>` : ''}</h3>
    ${e.note ? `<p class="qctx">${linkify(e.note)}</p>` : ''}
    <div class="qmeta">${tags}<span>${esc(whenLabel(e.createdAt, now))}</span>
      <button type="button" class="btn line sm" data-jedit="${esc(e.id)}">Edit</button>
      <button type="button" class="btn line sm" data-jdel="${esc(e.id)}">Delete</button></div></li>`;
}

export function editHtml(e) {
  return `<li class="jnentry"><form class="jnform" data-jsave="${esc(e.id)}">
    <input class="qtext" name="title" maxlength="300" required value="${esc(e.title)}" aria-label="Title">
    <input class="qtext" name="link" type="url" maxlength="2000" value="${esc(e.link || '')}" placeholder="https://… (optional)" aria-label="Link">
    <textarea class="qtext" name="note" rows="3" maxlength="4000" placeholder="Note (optional)" aria-label="Note">${esc(e.note || '')}</textarea>
    <input class="qtext" name="tags" maxlength="300" value="${esc((e.tags || []).join(', '))}" placeholder="Tags (optional)" aria-label="Tags">
    <div class="qopts"><button class="btn">Save</button><button type="button" class="btn line" data-jcancel>Cancel</button></div>
  </form></li>`;
}

export function render(_d, _data, sub) {
  const tag = TAG_RE.test(sub || '') ? sub : '';
  return `<div class="wrap">
  <div class="head"><div><h1>Journal</h1><p>Links and ideas for later. Only you see these.</p></div></div>
  <form class="card pad jnadd">
    <input class="qtext" name="text" maxlength="2300" required autocomplete="off" placeholder="Paste a link or write an idea" aria-label="Paste a link or write an idea">
    <input class="qtext" name="tags" maxlength="300" autocomplete="off" placeholder="Tags (optional)" aria-label="Tags (optional)">
    <button class="btn">Add</button>
  </form>
  <nav class="chips jntags" aria-label="Filter by tag"></nav>
  <div class="card pad"><ul class="jnlist" data-tag="${esc(tag)}"><li class="muted">Loading…</li></ul></div>
</div>`;
}

export async function mount(el, { say }) {
  const list = el.querySelector('.jnlist');
  const tag = list.dataset.tag;
  let entries = [];
  const show = () => {
    const tags = [...new Set(entries.flatMap((e) => e.tags))].sort();
    el.querySelector('.jntags').innerHTML = tags.length ? [['', 'All'], ...tags.map((t) => [t, `#${t}`])]
      .map(([t, name]) => `<button type="button" class="chip${t === tag ? ' on' : ''}" data-page="journal${t ? `/${t}` : ''}">${esc(name)}</button>`).join('') : '';
    const shown = tag ? entries.filter((e) => e.tags.includes(tag)) : entries;
    list.innerHTML = shown.map((e) => entryHtml(e)).join('') || `<li class="muted">${tag ? `Nothing tagged #${esc(tag)}.` : 'Nothing saved yet.'}</li>`;
  };
  const send = async (method, url, body) => {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-CC': '1' }, body: body && JSON.stringify(body) }).catch(() => null);
    const j = await res?.json().catch(() => null);
    if (!res?.ok) say(j?.error || 'Could not save');
    return res?.ok ? j : null;
  };
  const find = (id) => entries.find((e) => e.id === id);

  el.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const v = (name) => f.elements[name].value;
    const btn = f.querySelector('button:not([type])');
    if (btn.disabled) return;
    btn.disabled = true;
    const id = f.dataset.jsave;
    const j = id
      ? await send('PATCH', `${API}/${id}`, { title: v('title'), link: v('link'), note: v('note'), tags: v('tags') })
      : await send('POST', API, quickEntry(v('text'), v('tags')));
    btn.disabled = false;
    if (!j) return;
    entries = id ? entries.map((x) => (x.id === id ? j.entry : x)) : [j.entry, ...entries];
    if (!id) { f.reset(); f.elements.text.focus(); }
    say('Saved');
    show();
  });
  el.addEventListener('click', async (e) => {
    const edit = e.target.closest('[data-jedit]');
    if (edit) {
      const id = edit.dataset.jedit;
      edit.closest('li').outerHTML = editHtml(find(id));
      list.querySelector(`[data-jsave="${id}"] [name=title]`).focus();
      return;
    }
    if (e.target.closest('[data-jcancel]')) { show(); return; }
    const del = e.target.closest('[data-jdel]');
    if (!del || !window.confirm(`Delete "${find(del.dataset.jdel).title}"?`)) return;
    if (await send('DELETE', `${API}/${del.dataset.jdel}`)) {
      entries = entries.filter((x) => x.id !== del.dataset.jdel);
      say('Deleted');
      show();
    }
  });

  const res = await fetch(`${API}?limit=500`).catch(() => null);
  const j = res?.ok ? await res.json().catch(() => null) : null;
  if (!j?.entries) { list.innerHTML = '<li class="muted">Could not load the journal.</li>'; return; }
  entries = j.entries; // shortcut: newest 500 only; page it when the journal passes that
  show();
}
