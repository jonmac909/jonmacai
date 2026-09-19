const TZ = 'America/Vancouver';
export const COLLECTIONS_HREF = 'https://collections.viralview.io/collections.html';
const GOAL = 10000;
const COLUMNS = [
  'New inquiry', 'Negotiating', 'Waiting on deposit', 'Script approval',
  'With editor', 'Video approval', 'Live · send invoice', 'Paid in September',
];
const STAGE_TO_COLUMN = {
  drafts: COLUMNS[0], 'new-lead': COLUMNS[0],
  negotiating: COLUMNS[1], 'contract-brief': COLUMNS[1],
  'invoice-sent': COLUMNS[2],
  'deposit-paid': COLUMNS[3], 'script-approval': COLUMNS[3],
  production: COLUMNS[4],
  'video-approval': COLUMNS[5],
  publishing: COLUMNS[6],
  paid: COLUMNS[7], done: COLUMNS[7],
};
const COLUMN_TO_BOARD = {
  'New inquiry': 'new-lead',
  Negotiating: 'negotiating',
  'Waiting on deposit': 'invoice-sent',
  'Script approval': 'script-approval',
  'With editor': 'production',
  'Video approval': 'video-approval',
  'Live · send invoice': 'publishing',
  'Paid in September': 'paid',
  Paid: 'paid',
};
const COL_PCT = {
  'New inquiry': 12, Negotiating: 25, 'Waiting on deposit': 37, 'Script approval': 50,
  'With editor': 62, 'Video approval': 75, 'Live · send invoice': 87, 'Paid in September': 100,
};
const ACTIVE = new Set(['deposit-paid', 'script-approval', 'production', 'video-approval', 'publishing', 'paid']);

export function mapColumn(stage) {
  return STAGE_TO_COLUMN[stage] || 'New inquiry';
}
export function boardStageFor(column) {
  return COLUMN_TO_BOARD[column] || 'new-lead';
}
export function usd(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(Number(n) || 0);
}

function parts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: 'numeric', day: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const year = Number(p.year);
  const month = Number(p.month);
  const day = Number(p.day);
  return { year, month, day, dim: new Date(year, month, 0).getDate(), monthName: new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' }) };
}
function ymd(ms) {
  const { year, month, day } = parts(ms);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function parseWhen(s) {
  const m = String(s || '').match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);
  if (m) {
    const months = 'january february march april may june july august september october november december'.split(' ');
    const mo = months.indexOf(m[1].toLowerCase()) + 1;
    if (mo) return Date.parse(`${m[3]}-${String(mo).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}T12:00:00-07:00`);
  }
  return Date.parse(s);
}
function daysBetween(fromMs, toMs) {
  const a = Date.parse(`${ymd(fromMs)}T12:00:00-07:00`);
  const b = Date.parse(`${ymd(toMs)}T12:00:00-07:00`);
  return Math.round((b - a) / 86400000);
}
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function needles(item) {
  const n = norm(item.sponsor);
  return n === 'viktor' ? ['viktor', 'schalumov'] : [n];
}
export function matchItem(card, items) {
  const blob = norm(card.sponsor) + norm(card.contact);
  return (items || []).find((item) => needles(item).some((a) => a && blob.includes(a))) || null;
}
function hasDraft(card) {
  const dr = card.draftReply;
  return !!(dr && ['needs-review', 'edited', 'approved'].includes(dr.status) && String(dr.body || '').trim());
}
export function keepCard(card, nowMs, items) {
  if (card.stage === 'archived') return false;
  const t = Date.parse(card.latestDate);
  if (card.stage === 'done' && Number.isFinite(t) && ymd(t).slice(0, 7) !== ymd(nowMs).slice(0, 7)) return false;
  return !!(matchItem(card, items) || hasDraft(card) || ACTIVE.has(card.stage));
}
function pillFor(card, item, nowMs) {
  if (card.stage === 'paid' || card.stage === 'done') return { pill: 'Paid', pillCls: 'ok' };
  if (card.stage === 'production') return { pill: 'In progress', pillCls: '' };
  if (hasDraft(card)) return { pill: 'Your move', pillCls: 'blue' };
  const when = item?.lastEmail || card.latestDate;
  const t = parseWhen(when);
  const days = Number.isFinite(t) ? daysBetween(t, nowMs) : 0;
  if (item?.bucket === 'collect-now' && days > 0) return { pill: `${days} days late`, pillCls: 'crit' };
  if (days >= 5) return { pill: `${days} days quiet`, pillCls: 'risk' };
  return { pill: 'Waiting on them', pillCls: 'risk' };
}

function oneDec(n) {
  return Math.round(n * 10) / 10;
}

export function buildSponsorsPage(data, nowMs = Date.now(), overrides = {}) {
  const col = data.collections || {};
  const items = col.items || [];
  const cards = (data.cards || []).map((c) => (overrides[c.id] ? { ...c, stage: overrides[c.id] } : c));
  const cal = parts(nowMs);
  const collected = Number(col.incomeTotals?.[col.currentIncomeMonth] || 0);
  const owed = items.reduce((s, i) => s + (Number(i.owed) || 0), 0);
  const open = items.filter((i) => Number(i.owed) > 0);
  const completed = (col.completedIncomeMonths || []).map((m) => Number(col.incomeTotals?.[m] || 0));
  const avg = completed.length ? completed.reduce((s, n) => s + n, 0) / completed.length : 0;
  const emails = cards.filter(hasDraft);
  const pace = Math.round(GOAL * cal.day / cal.dim);
  const short = GOAL - avg;
  const stack = collected + owed;
  const buckets = {
    'collect-now': open.filter((i) => i.bucket === 'collect-now').reduce((s, i) => s + i.owed, 0),
    'delivery-balance': open.filter((i) => i.bucket === 'delivery-balance').reduce((s, i) => s + i.owed, 0),
    'lock-deal': open.filter((i) => i.bucket === 'lock-deal').reduce((s, i) => s + i.owed, 0),
  };
  const den = stack || 1;
  const barParts = [
    { key: 'Collected', amount: collected, fill: 'var(--ok-fill)' },
    { key: 'Collect now', amount: buckets['collect-now'], fill: 'var(--crit-fill)' },
    { key: 'Owed after posting', amount: buckets['delivery-balance'], fill: 'var(--accent)' },
    { key: 'Lock deal', amount: buckets['lock-deal'], fill: 'var(--risk-fill)' },
  ].map((p) => ({ pct: oneDec(p.amount / den * 100), fill: p.fill, tip: `${p.key} ${usd(p.amount)}`, legend: p.key, amount: usd(p.amount) }));
  const columns = COLUMNS.map((stage) => ({
    stage,
    boardStage: boardStageFor(stage),
    empty: stage === 'Live · send invoice' ? 'Nothing here. Cards land here the moment a sponsor video goes live.' : '',
    cards: [],
  }));
  const colIx = Object.fromEntries(COLUMNS.map((s, i) => [s, i]));
  for (const card of cards) {
    if (!keepCard(card, nowMs, items)) continue;
    const stage = mapColumn(card.stage);
    const item = matchItem(card, items);
    const amt = item ? Number(item.total) : Number(card.amount) || 0;
    const { pill, pillCls } = pillFor(card, item, nowMs);
    const draft = hasDraft(card);
    const k = {
      id: card.id,
      name: card.sponsor,
      boardStage: card.stage,
      pill,
      pillCls,
      amt,
      amtLabel: amt ? usd(amt) : 'Not priced',
      detail: card.subject || card.status || '',
      pct: COL_PCT[stage] || 12,
      pg: pillCls === 'crit' ? 'crit' : (pillCls === 'ok' ? 'ok' : ''),
    };
    if (draft) {
      k.btn = 'Approve reply';
      k.draft = true;
      k.payload = {
        id: card.id,
        to: card.draftReply?.to || '',
        subject: card.draftReply?.subject || card.subject || '',
        body: card.draftReply?.body || '',
        saveKind: 'sponsor.save_draft',
        sendKind: 'sponsor.send_draft',
        discardKind: 'sponsor.discard_draft',
      };
    } else if (card.stage === 'publishing') {
      k.btn = 'Send invoice';
      k.kind = 'sponsor.send_invoice';
      k.payload = { id: card.id, sponsor: card.sponsor };
      k.btnCls = 'line';
    } else if (card.stage !== 'paid' && card.stage !== 'done') {
      k.btn = 'Nudge';
      k.kind = 'sponsor.nudge';
      k.payload = { id: card.id };
      k.btnCls = 'line';
    }
    columns[colIx[stage]].cards.push(k);
  }
  const byMonth = Object.entries(col.incomeTotals || {}).map(([month, amount]) => {
    const pct = Math.min(100, Math.round(Number(amount) / GOAL * 100));
    const hit = Number(amount) >= GOAL;
    return {
      label: month === col.currentIncomeMonth ? `${month} so far` : month,
      value: hit ? `${usd(amount)} · goal hit` : usd(amount),
      pct,
      pg: hit ? 'ok' : 'risk',
    };
  });
  return {
    title: 'Sponsors',
    sub: `From your collections tracker · ${data.updatedAt ? 'live' : 'updated'}`,
    actions: [
      { label: 'Open collections page', href: COLLECTIONS_HREF },
      { label: 'Scan inbox now', kind: 'sponsor.scan_inbox', payload: { msg: 'Scanning sponsor inbox now' } },
    ],
    tiles: [
      { icon: 'check', label: `Collected in ${cal.monthName}`, value: usd(collected), goal: '/ $10K', pct: Math.round(collected / GOAL * 100), sub: `Day ${cal.day} of ${cal.dim} · pace would be ${usd(pace)}` },
      { icon: 'dollar', label: 'Owed to you', value: usd(owed), sub: `${open.length} sponsor${open.length === 1 ? '' : 's'}` },
      { icon: 'chart', label: 'Average month since May', value: usd(avg), goal: '/ $10K', pct: Math.min(100, Math.round(avg / GOAL * 100)), pg: avg >= GOAL ? 'ok' : 'risk', sub: avg >= GOAL ? 'Goal hit' : `${usd(short)} a month short of goal` },
      { icon: 'mail', label: 'Sponsor emails waiting', value: String(emails.length), sub: emails.length === 1 ? '1 reply drafted' : `All ${emails.length} replies drafted` },
    ],
    septemberBar: {
      title: `${cal.monthName} toward $10,000`,
      meta: `${usd(stack)} if everything owed comes in`,
      aria: barParts.map((p) => `${p.legend} ${p.amount}`).join(', '),
      goalAt: Math.min(100, oneDec(GOAL / den * 100)),
      parts: barParts,
      line: 'Line marks the $10K goal',
    },
    board: { title: 'Deal board', meta: 'Drag a card to move it', columns },
    collect: {
      title: 'Money to collect',
      meta: `${open.length} open item${open.length === 1 ? '' : 's'} · ${usd(owed)}`,
      rows: open.map((item) => {
        const card = cards.find((c) => matchItem(c, [item]));
        const paidPct = item.total ? Math.round(item.paid / item.total * 100) : 0;
        const pillCls = item.bucket === 'collect-now' ? 'crit' : item.bucket === 'lock-deal' ? 'risk' : 'blue';
        return {
          sponsor: item.sponsor,
          pill: item.bucketLabel,
          pillCls,
          total: usd(item.total),
          owed: usd(item.owed),
          paidPct,
          paid: usd(item.paid),
          pg: paidPct >= 100 ? 'ok' : pillCls === 'crit' ? 'crit' : 'risk',
          block: item.blocker,
          next: item.action,
          btn: 'Nudge',
          btnCls: 'line',
          kind: 'sponsor.nudge',
          payload: { id: card?.id, sponsor: item.sponsor },
          paidKind: 'sponsor.mark_paid',
          paidPayload: { sponsor: item.sponsor },
        };
      }),
    },
    emails: {
      title: 'Sponsor emails',
      meta: 'From the inbox scan · nothing sends without you',
      rows: emails.map((c) => ({
        id: c.id,
        title: c.sponsor,
        sub: c.subject || 'Reply drafted',
        to: c.draftReply.to || '',
        subject: c.draftReply.subject || c.subject || '',
        body: c.draftReply.body || '',
        send: `Reply sent to ${c.sponsor}`,
        saveKind: 'sponsor.save_draft',
        sendKind: 'sponsor.send_draft',
        discardKind: 'sponsor.discard_draft',
      })),
    },
    byMonth: { title: 'Collected by month', meta: 'Against $10K', rows: byMonth },
  };
}

export function applyHomeSponsors(snap, page) {
  const collected = page.tiles[0].value;
  const owed = page.tiles[1].value;
  const n = page.collect.rows.length;
  const pct = page.tiles[0].pct;
  if (snap.pages?.home?.tiles?.[0]) {
    snap.pages.home.tiles[0] = {
      ...snap.pages.home.tiles[0],
      value: collected,
      pct,
      sub: `${owed} more is owed · ${pct >= 100 ? 'goal hit' : 'enough to pass $10K'}`,
    };
  }
  if (snap.pages?.home?.glance?.rows?.[0]) {
    const row = snap.pages.home.glance.rows[0];
    row.today = `${collected} in · ${owed} owed by ${n} sponsor${n === 1 ? '' : 's'}`;
    row.pct = pct;
    row.pill = `${pct}%`;
    row.pillCls = pct >= 100 ? 'ok' : pct >= 50 ? 'risk' : 'crit';
  }
  if (snap.goal) snap.goal.pct = pct;
  if (snap.nav?.badges) snap.nav.badges.sponsors = Number(page.tiles[3].value) || 0;
}

export function overlaySponsors(page, data, nowMs = Date.now(), overrides = {}) {
  if (!page) return page;
  const actions = [
    { label: 'Open collections page', href: COLLECTIONS_HREF },
    { label: 'Scan inbox now', kind: 'sponsor.scan_inbox', payload: { msg: 'Scanning sponsor inbox now' } },
  ];
  if (!data?.collections) {
    page.actions = actions;
    page.unverified = true;
    page.sourceNote = 'Collections origin not connected';
    return page;
  }
  const built = buildSponsorsPage(data, nowMs, overrides);
  Object.assign(page, built);
  page.actions = actions;
  return page;
}
