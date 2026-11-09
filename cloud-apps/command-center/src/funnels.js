import { PRODUCTS } from '../../homeguidepress/src/products.js';

// Dashboard 2 Funnels (Jon's ask, 2026-11-09): every Home Guide Press book page, checked live each time the page opens.
// Books: the shop's own product list, bundled at deploy. Page: GET <site>/<path> answers 200. Buy: /go/<key> answers a
// 302 to a commas.com checkout. Proof the checkout takes money: the book's last real sale in the shop's D1.
// Checks carry ?src=dashboard-check, so the shop's stats (scripts/stats.mjs groups by src) keep them apart from visitors.
export const SITE = 'https://homeguidepress.com';
const TAG = 'src=dashboard-check';
const SINGLE = 27;
const CHECKOUT = /^https:\/\/(?:www\.)?commas\.com\/checkout\/[A-Za-z0-9]+/;
const TZ = 'America/Vancouver';
const RANK = { crit: 0, risk: 1, ok: 2 };

async function hit(fetcher, url) {
  try {
    const r = await fetcher(url, { redirect: 'manual', headers: { 'user-agent': 'jonmac-dashboard-funnels' } });
    return { code: r.status, to: r.headers.get('location') || '' };
  } catch {
    return { code: 0, to: '' };
  }
}

const usd = (n) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' });

async function lastSales(db) {
  if (!db) return null;
  try { // SQLite: the bare amount_cents comes from the row that holds MAX(created_at)
    const r = await db.prepare(`SELECT slug, amount_cents, MAX(created_at) AS last, COUNT(*) AS n FROM orders
      WHERE is_test = 0 AND revoked_at IS NULL AND slug IS NOT NULL GROUP BY slug`).all();
    return Object.fromEntries((r.results || []).map((x) => [x.slug, x]));
  } catch {
    return null;
  }
}

function buyOf(buy, p, sale, salesKnown) {
  if (buy.code === 302 && CHECKOUT.test(buy.to)) {
    if (!salesKnown) return { text: 'Goes to checkout', cls: 'risk', note: 'Sales could not be read' };
    if (!sale) return { text: 'No sale yet', cls: 'risk', note: 'Goes to a Commas checkout; no sale proves it yet' };
    const paid = sale.amount_cents / 100;
    const note = `Last sale ${usd(paid)} on ${day(sale.last)}, ${sale.n} sold`;
    return Math.abs(paid - p.price) < 0.005 ? { text: 'Working', cls: 'ok', note } : { text: 'Check price', cls: 'crit', note: `${note}; the page says ${usd(p.price)}` };
  }
  if (buy.code === 302) return { text: 'No checkout', cls: 'crit', note: 'Buy goes back to the page' };
  return { text: 'Broken', cls: 'crit', note: buy.code ? `The Buy link answered ${buy.code}` : 'The Buy link did not answer' };
}

export async function funnelsData(env, fetcher = fetch, nowMs = Date.now()) {
  const sales = await lastSales(env.HGP_DB);
  const rows = await Promise.all(PRODUCTS.map(async (p, i) => {
    const url = `${SITE}/${p.path}`;
    const [page, buy] = await Promise.all([hit(fetcher, `${url}?${TAG}`), hit(fetcher, `${SITE}/go/${p.key}?${TAG}`)]);
    const row = {
      key: p.key,
      book: p.title,
      author: p.persona?.host || '',
      channel: p.persona?.brand || '',
      url,
      page: page.code === 200 ? { text: 'Loads', cls: 'ok' } : { text: 'Down', cls: 'crit', note: page.code ? `Answered ${page.code}` : 'No answer' },
      price: p.price === SINGLE ? { text: usd(p.price), cls: 'ok' } : { text: usd(p.price), cls: 'risk', note: `Not the ${usd(SINGLE)} single price` },
      buy: buyOf(buy, p, sales?.[p.key], !!sales),
      order: i,
    };
    row.worst = Math.min(...[row.page, row.price, row.buy].map((x) => RANK[x.cls]));
    return row;
  }));
  rows.sort((a, b) => a.worst - b.worst || a.order - b.order); // problems first, then the shop's order
  const count = (f) => rows.filter(f).length;
  return {
    checkedAt: new Date(nowMs).toISOString(),
    checked: new Date(nowMs).toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' }),
    total: rows.length,
    loads: count((r) => r.page.cls === 'ok'),
    working: count((r) => r.buy.cls === 'ok'),
    problems: count((r) => r.worst === RANK.crit),
    salesKnown: !!sales,
    rows: rows.map(({ order, worst, ...r }) => r),
  };
}
