import { ymd } from './life.js';

const STEPS = [
  { label: 'Sponsor emails', page: 'sponsors' },
  { label: 'Bank scan', page: 'money' },
  { label: 'Market check', page: 'markets' },
  { label: 'Mastermind digest', page: 'mastermind' },
  { label: 'Support replies', page: 'support' },
  { label: 'Posts out', page: 'content' },
  { label: 'Workout 11:00', page: 'life' },
];

function parse(row) {
  try { return JSON.parse(row.data); } catch { return {}; }
}

function todayOf(row, nowMs) {
  return row && ymd(Date.parse(row.collected_at) || nowMs) === ymd(nowMs);
}

function lateDays(pill) {
  const m = String(pill || '').match(/(\d+) days late/);
  return m ? Number(m[1]) : 0;
}

function overlayBank(snap, by, nowMs) {
  const row = by.bank_scan;
  if (!row || !snap.pages?.money) return;
  const accounts = parse(row).accounts || [];
  const today = ymd(nowMs);
  const rows = accounts.map((a) => {
    const scanned = a.status === 'scanned' && ymd(Date.parse(a.scannedAt || row.collected_at) || nowMs) === today;
    const need = a.status === 'needs_code';
    return {
      title: a.name,
      sub: need ? 'Sent you a code' : (scanned ? 'Scanned' : a.status || ''),
      pill: need ? 'Needs code' : scanned ? 'Scanned' : 'Waiting',
      pillCls: need ? 'risk' : scanned ? 'ok' : '',
      btn: need ? 'Enter code' : '',
      msg: need ? 'Code box opened' : '',
    };
  });
  const done = rows.filter((r) => r.pill === 'Scanned').length;
  snap.pages.money.bankScan = {
    title: 'Bank scan',
    meta: `${done} of ${accounts.length} accounts done`,
    pct: accounts.length ? Math.round(done / accounts.length * 100) : 0,
    pg: done === accounts.length ? 'ok' : 'risk',
    rows,
  };
}

function runSteps(snap, by, extra, nowMs) {
  const today = ymd(nowMs);
  const emails = snap.pages?.sponsors?.emails?.rows || [];
  const bank = snap.pages?.money?.bankScan?.rows || [];
  const picks = snap.pages?.mastermind?.picks?.jobs || [];
  const drafts = snap.pages?.support?.drafts?.rows || [];
  const money = snap.pages?.support?.money?.rows || [];
  const posts = Number(snap.pages?.content?.tiles?.[0]?.value) || 0;
  const market = (extra.checklist || []).some((c) => c.item === 'market_check' && c.day === today);
  const workout = (extra.habits || []).some((h) => h.kind === 'workout' && Number(h.done) && h.day === today);
  const bankDone = by.bank_scan && bank.length && bank.every((r) => r.pill === 'Scanned');
  const flags = [
    Boolean(by.sponsors && todayOf(by.sponsors, nowMs) && emails.length === 0),
    Boolean(bankDone),
    market,
    Boolean(by.mastermind && picks.length === 0),
    Boolean(by.support && drafts.length === 0 && money.length === 0),
    posts >= 12,
    workout,
  ];
  return STEPS.map((s, i) => ({ ...s, done: Boolean(flags[i]) }));
}

function needsList(snap, by, nowMs) {
  const jobs = [];
  const collect = snap.pages?.sponsors?.collect?.rows || [];
  const cards = by.sponsors ? (snap.pages?.sponsors?.board?.columns || []).flatMap((c) => c.cards || []) : [];
  for (const card of cards) {
    const days = lateDays(card.pill);
    if (!days) continue;
    const item = collect.find((r) => String(r.sponsor).toLowerCase().includes(String(card.name).toLowerCase().slice(0, 6).toLowerCase())) || collect[0];
    jobs.push({
      rank: 1, days,
      area: 'Sponsors', pill: card.pill, pillCls: 'crit',
      title: `Chase ${card.name}'s ${item?.owed || card.amtLabel} deposit`,
      lines: [item?.block || item?.next || 'Payment is late', item?.next || 'Open Sponsors'].slice(0, 2),
      btn: 'Review email', page: 'sponsors', id: card.id,
    });
  }
  if (by.bank_scan) {
    for (const r of snap.pages?.money?.bankScan?.rows || []) {
      if (r.pill !== 'Needs code') continue;
      jobs.push({
        rank: 2, days: 0,
        area: 'Finances', pill: 'Paused', pillCls: 'risk',
        title: 'Enter bank text code',
        lines: [r.title, r.sub].filter(Boolean),
        btn: 'Enter code', msg: 'Code box opened', done: true, keyName: r.title,
      });
    }
  }
  for (const a of snap.pages?.agents?.waiting?.jobs || []) {
    jobs.push({
      rank: 2, days: 0,
      area: a.area || 'Agents', pill: a.pill || 'Needs you', pillCls: 'risk',
      title: a.title, lines: a.lines || [], page: a.page || 'agents', btn: a.btn || 'Open',
    });
  }
  const tickets = parse(by.support || { data: '{}' }).tickets || [];
  const drafts = tickets.filter((t) => !t.money).sort((a, b) => (Number(b.waitedMs) || 0) - (Number(a.waitedMs) || 0));
  for (const t of drafts) {
    jobs.push({
      rank: 3, days: Number(t.waitedMs) || 0,
      area: 'Support', pill: 'Drafted', pillCls: 'ok',
      title: `Approve "${t.subject}"`,
      lines: [t.plan || 'Email', t.waitedMs ? `waited ${Math.round(t.waitedMs / 3600000)} hours` : 'draft waiting'],
      btn: 'Review replies', page: 'support',
    });
  }
  for (const e of snap.pages?.sponsors?.emails?.rows || []) {
    jobs.push({
      rank: 3, days: 0,
      area: 'Sponsors', pill: 'Drafted', pillCls: 'ok',
      title: `Approve ${e.title} reply`,
      lines: [e.sub || 'Reply drafted'],
      btn: 'Review email', page: 'sponsors',
    });
  }
  jobs.sort((a, b) => a.rank - b.rank || (a.rank === 1 ? b.days - a.days : a.rank === 3 ? b.days - a.days : 0));
  return jobs;
}

function applyGlance(snap) {
  const home = snap.pages?.home;
  if (!home?.glance?.rows) return;
  const row = (area) => home.glance.rows.find((r) => r.area === area);
  const content = snap.pages.content?.tiles?.[0];
  const c = row('Content');
  if (c && content) {
    c.today = `${content.value} posts out`;
    c.pct = content.pct;
    c.pg = content.pg;
    c.pill = `${content.pct}%`;
    c.pillCls = content.pg === 'ok' ? 'ok' : content.pg === 'crit' ? 'crit' : 'risk';
  }
  const yt = snap.pages.youtube?.tiles?.[0];
  const y = row('YouTube videos');
  if (y && yt) {
    y.today = `${yt.value} live`;
    y.pct = yt.pct;
    y.pill = `${yt.value} of 3`;
  }
  const out = snap.pages.outreach;
  const o = row('Cold outreach');
  if (o && out?.setup) {
    o.today = `Setup ${out.setup.done}`;
    o.pct = out.setup.pct;
    o.pill = out.pill || 'Setup';
  }
  const sup = snap.pages.support?.tiles?.[0];
  const s = row('Support');
  if (s && sup) {
    s.today = `${sup.value} tickets waiting`;
  }
  if (home.tiles?.[2] && content) {
    home.tiles[2] = { ...home.tiles[2], value: content.value, pct: content.pct, pg: content.pg, sub: content.sub };
  }
  if (home.tiles?.[3] && yt) {
    home.tiles[3] = { ...home.tiles[3], value: yt.value, pct: yt.pct, sub: snap.pages.youtube.tiles[1]?.sub || yt.sub };
  }
}

export function applyHome(snap, by = {}, extra = {}, nowMs = Date.now()) {
  if (!snap.pages?.home) return snap;
  overlayBank(snap, by, nowMs);
  if (snap.pages.home.runThrough) {
    const steps = runSteps(snap, by, extra, nowMs);
    const done = steps.filter((s) => s.done).length;
    snap.pages.home.runThrough = {
      ...snap.pages.home.runThrough,
      steps, done, total: steps.length, pct: Math.round(done / steps.length * 100),
    };
  }
  if (snap.pages.home.needsYou) {
    const all = needsList(snap, by, nowMs);
    snap.pages.home.needsYou.all = all;
    snap.pages.home.needsYou.jobs = all.slice(0, 3);
    snap.pages.home.needsYou.viewAll = `View all ${all.length}`;
    snap.pages.home.needsYou.viewAllMsg = `Opened the full list · ${all.length} items`;
  }
  applyGlance(snap);
  if (snap.pages.life && snap.pages.home.life) {
    const L = snap.pages.life;
    const w = L.workouts?.weeks?.[0];
    if (w) snap.pages.home.life.workout = { ...snap.pages.home.life.workout, dots: w.dots, pct: L.tiles?.[0]?.pct, sub: w.sub };
    const n = L.dateNight?.rows?.[0];
    if (n) snap.pages.home.life.dateNight = { ...snap.pages.home.life.dateNight, sub: n.sub, btn: n.btn || snap.pages.home.life.dateNight.btn, msg: n.msg || snap.pages.home.life.dateNight.msg, kind: n.kind, payload: n.payload, confirm: n.confirm };
  }
  const pick = snap.pages.mastermind?.picks?.jobs?.[0];
  if (pick && snap.pages.home.mastermindPick) {
    snap.pages.home.mastermindPick = {
      ...snap.pages.home.mastermindPick,
      pill: pick.pill, heading: pick.title, body: (pick.lines || []).join(' · '),
      btn: pick.btn, kind: pick.kind, payload: pick.payload,
    };
  }
  if (snap.pages.agents?.tiles && snap.pages.home.life?.agents) {
    const need = snap.pages.agents.tiles[0]?.value || '0';
    const work = snap.pages.agents.tiles[1]?.value || '0';
    snap.pages.home.life.agents.sub = `${need} need you · ${work} working`;
  }
  return snap;
}

export function nextMorningStep(run) {
  return (run?.steps || []).find((s) => !s.done) || null;
}

export function criticalAlerts(snap) {
  const out = [];
  if (snap.sources?.bank_scan) {
    for (const r of snap.pages?.money?.bankScan?.rows || []) {
      if (r.pill === 'Needs code') out.push({ key: `bank_code:${r.title}`, text: `Bank code needed: ${r.title}` });
    }
  }
  if (snap.sources?.sponsors) {
    for (const col of snap.pages?.sponsors?.board?.columns || []) {
      for (const card of col.cards || []) {
        const days = lateDays(card.pill);
        if (days > 7) out.push({ key: `late:${card.id || card.name}`, text: `Payment ${days} days late: ${card.name}` });
      }
    }
  }
  return out;
}

export function unsentCritical(alerts, sent = {}) {
  return alerts.filter((a) => !sent[a.key]);
}

export async function pushCriticalTelegram(env, snap, fetchFn = globalThis.fetch) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID || !env.DB) return;
  const row = (await env.DB.prepare('SELECT source, data, collected_at, received_at FROM snapshots').all()).results?.find((r) => r.source === 'telegram_sent');
  let sent = {};
  try { sent = row ? JSON.parse(row.data).sent || {} : {}; } catch { sent = {}; }
  const next = unsentCritical(criticalAlerts(snap), sent);
  for (const a of next) {
    await fetchFn(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: a.text }),
    }).catch(() => {});
    sent[a.key] = new Date().toISOString();
  }
  if (next.length) {
    const now = new Date().toISOString();
    await env.DB.prepare('INSERT OR REPLACE INTO snapshots (source, data, collected_at, received_at) VALUES (?, ?, ?, ?)')
      .bind('telegram_sent', JSON.stringify({ sent }), now, now).run();
  }
}
