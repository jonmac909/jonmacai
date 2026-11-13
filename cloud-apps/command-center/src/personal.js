// The Personal page (migration 0028_personal.sql) and the expense tags on the Money page.
//   GET  /dashboard/api/personal          Jon's saved meals, prices, trips and rules, the expense tags, and MoneyClaw's
//                                         spending (personal and business month totals, business categories and charges)
//   PUT  /dashboard/api/personal/<key>    save one of meals | prices | trips | rules (a JSON value, 200 kB at most)
//   POST /dashboard/api/personal/tags     { id, tag } tags one charge ('' clears it)
//   POST /dashboard/api/personal/photo    a recipe photo (image body): stored in R2, and read into text by Claude when the
//                                         Worker has an ANTHROPIC_API_KEY
// Writes are Jon's only (session + X-CC, checked by the caller).
const KEYS = ['meals', 'prices', 'trips', 'rules'];
export const TAGS = ['ok', 'fixed', 'once', 'sus', 'new', 'subs', 'cancel', 'refund'];
const MAX = 200000;
const PHOTO_MAX = 8 * 1024 * 1024;
const IMG = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const bad = (error, status = 400) => ({ status, body: { ok: false, error } });
const good = (body = {}) => ({ status: 200, body: { ok: true, ...body } });

const num = (period) => {
  if (!period) return null;
  if (typeof period.total === 'number') return period.total;
  return Number.isFinite(Number(period.totalCents)) ? Number(period.totalCents) / 100 : null;
};

// MoneyClaw's snapshot, reduced to what the Personal and Money pages show.
export function spendOut(data, receivedAt = null) {
  const ex = data?.expenses || {};
  const charge = (c) => ({
    id: String(c.id ?? ''), date: String(c.date || '').slice(0, 10), what: String(c.description || '').slice(0, 160),
    cat: String(c.category || 'Uncategorized').slice(0, 60), amount: Number(c.amount) || 0, pending: !!c.pending, group: String(c.group || ''),
  });
  const unc = (ex.uncategorized || []).map(charge).filter((c) => c.id);
  return {
    at: receivedAt,
    personal: { month: num(ex.personal?.month), charges: unc.filter((c) => c.group === 'personal') },
    business: {
      month: num(ex.business?.month),
      categories: (ex.businessCategories || []).map((c) => ({ name: String(c.name || ''), count: Number(c.count) || 0, total: typeof c.total === 'number' ? c.total : (Number(c.totalCents) || 0) / 100 })),
      charges: [...(ex.latestBusinessCharges || []).map(charge), ...unc.filter((c) => c.group !== 'personal')].filter((c, i, a) => c.id && a.findIndex((x) => x.id === c.id) === i),
    },
  };
}

export async function personalData(env) {
  const all = async (sql) => (await env.DB.prepare(sql).all()).results || [];
  const [rows, tags, snap] = await Promise.all([
    all('SELECT key, data FROM personal_store'),
    all('SELECT id, tag FROM expense_tags'),
    all("SELECT data, received_at FROM snapshots WHERE source = 'moneyclaw'"),
  ]);
  const store = {};
  for (const r of rows) { try { store[r.key] = JSON.parse(r.data); } catch { /* skip a broken row */ } }
  let money = null;
  try { money = snap[0] ? spendOut(JSON.parse(snap[0].data), snap[0].received_at) : null; } catch { money = null; }
  return { store, tags: Object.fromEntries(tags.map((t) => [t.id, t.tag])), money };
}

// Claude reads a recipe photo into plain text. Raw fetch: this Worker has no npm dependencies to bundle.
async function readPhoto(env, bytes, type, fetchFn) {
  if (!env.ANTHROPIC_API_KEY) return { text: '', note: 'Photo saved. Reading photos needs a Claude API key on the dashboard Worker.' };
  let b64 = '';
  const u8 = new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) b64 += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  b64 = btoa(b64);
  const res = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 8000,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: type, data: b64 } },
        { type: 'text', text: 'This is a photo of a recipe. Write out the recipe as plain text: the recipe name on the first line, then a line "Ingredients" with one ingredient per line (amount first), then a line "Method" with numbered steps. Only the recipe, nothing else. If there is no recipe in the photo, answer with just: NO RECIPE' },
      ] }],
    }),
  });
  const b = await res.json().catch(() => null);
  if (!res.ok) return { text: '', note: `Photo saved, but Claude could not read it (${b?.error?.message || res.status}).` };
  if (b?.stop_reason === 'refusal') return { text: '', note: 'Photo saved, but Claude would not read it.' };
  const text = (b?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
  if (!text || text === 'NO RECIPE') return { text: '', note: 'Photo saved, but no recipe was found in it.' };
  return { text, note: 'Filled in from the photo. Check it.' };
}

export async function personalWrite(env, method, rest, request, fetchFn = globalThis.fetch, nowMs = Date.now()) {
  const now = new Date(nowMs).toISOString();
  if (rest === '/photo' && method === 'POST') {
    const type = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!IMG[type]) return bad('Send a photo (JPEG, PNG, WebP or GIF)');
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return bad('The photo is empty');
    if (bytes.byteLength > PHOTO_MAX) return bad('The photo is too big (8 MB at most)');
    let url = '';
    if (env.UPLOADS) {
      const name = `${crypto.randomUUID().replace(/-/g, '')}.${IMG[type]}`;
      await env.UPLOADS.put(`proofs/${name}`, bytes, { httpMetadata: { contentType: type } });
      url = `/dashboard/f/${name}`;
    }
    const read = await readPhoto(env, bytes, type, fetchFn).catch((err) => ({ text: '', note: `Photo saved, but reading it failed (${err.message}).` }));
    return good({ url, ...read });
  }
  const b = method === 'GET' ? {} : await request.json().catch(() => undefined);
  if (rest === '/tags' && method === 'POST') {
    const id = String(b?.id ?? '').trim();
    if (!id || id.length > 120) return bad('Needs the charge');
    if (!b.tag) { await env.DB.prepare('DELETE FROM expense_tags WHERE id = ?').bind(id).run(); return good(); }
    if (!TAGS.includes(b.tag)) return bad('Unknown tag');
    await env.DB.prepare('INSERT OR REPLACE INTO expense_tags (id, tag, updated_at) VALUES (?, ?, ?)').bind(id, b.tag, now).run();
    return good();
  }
  const k = /^\/([a-z]+)$/.exec(rest)?.[1];
  if (k && KEYS.includes(k) && method === 'PUT') {
    if (b === undefined || b === null || typeof b !== 'object') return bad('Needs the data');
    const data = JSON.stringify(b);
    if (data.length > MAX) return bad('Too much to save at once');
    await env.DB.prepare('INSERT OR REPLACE INTO personal_store (key, data, updated_at) VALUES (?, ?, ?)').bind(k, data, now).run();
    return good();
  }
  return bad('Not found', 404);
}
