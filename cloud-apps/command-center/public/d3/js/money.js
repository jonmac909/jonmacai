// Dashboard 3 Money page (docs/dashboard-3.md), laid out as the approved design (Money.dc.html). View only. Pure
// functions over the /dashboard/api/d2 and /dashboard/api/d3 answers:
//   sponsor cash, pace and deposits  d2 goals 'sponsors' (the same ledger as Goals)
//   Viral View MRR                   d2 money tiles
//   deals by stage                   d2's cleaned Sponsors board (its 10 columns grouped into the design's 6)
//   weekly tokens                    d3 rail tokens and goals.tokenWeeks
// Team cost, expenses, profit, YouTube ads, affiliates and forecast have no feed yet and read "No feed".
import { esc, usd, toneOf, icon } from './util.js';
import { headerOnly, periodOf } from './goals.js';

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const one = (v) => (Array.isArray(v) ? v[0] : v) || null;
const PILL = { r: 'bad', y: 'warn', g: 'ok', n: '' };
const NF = '<b class="nf">No feed</b>';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDay = (ymd) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`;
const andList = (a) => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

// The design's six stages, each the d2 Sponsors board columns it holds.
export const DEAL_STAGES = [
  ['Lead', ['Leads']], ['Negotiating', ['Negotiations']], ['Agreed', ['Deals']],
  ['In production', ['Deposit Paid', 'Video Production', 'Video Approved', 'Video Live']],
  ['Invoiced', ['Deposit Invoice', 'Balance Invoice']], ['Paid', ['Paid & Done']],
];
const TONE = { crit: 'r', risk: 'y', warn: 'y', ok: 'g' };

export function dealStages(d2resp) {
  const cols = (d2resp?.d2?.pipeline?.boards || []).find((b) => b.goal === 'sponsors')?.sponsors?.board?.columns;
  if (!Array.isArray(cols)) return null;
  return DEAL_STAGES.map(([name, from]) => {
    const deals = cols.filter((c) => !c.archived && from.includes(c.title)).flatMap((c) => c.cards || []).map((k) => ({
      name: k.name || 'Sponsor', amt: num(k.amt) && k.amt > 0 ? k.amt : null, draft: !!k.draft,
      note: k.draft ? 'your send' : k.pill || '', tone: k.draft ? 'y' : TONE[k.pillCls] || '',
    }));
    return { name, deals };
  });
}

function tile(label, sub, value) {
  const v = value == null ? '<b class="num sp nf">No feed</b>' : `<b class="num sp" style="font-size: 28px">${esc(value)}</b>`;
  return `<div class="tile" style="flex: 1 1 200px"><span class="stack" style="white-space: nowrap; min-width: 0"><b>${esc(label)}</b><span class="mut ell">${esc(sub)}</span></span>${v}</div>`;
}

// Collected so far as a running total that steps on each deposit day, as a share of the target.
function stepSeries(perDay, P, target) {
  if (!perDay || !(target > 0) || !P.ymd) return null;
  const first = `${P.ymd.slice(0, 7)}-01`;
  const days = Object.keys(perDay).filter((d) => d >= first && d <= P.ymd).sort();
  const pts = [[0, 0]];
  let cum = 0;
  for (const d of days) {
    const x = Math.min(P.monthT, (Number(d.slice(8, 10)) - 1) / P.daysInMonth);
    pts.push([x, cum / target]);
    cum += Number(perDay[d]) || 0;
    pts.push([x, cum / target]);
  }
  pts.push([P.monthT, cum / target]);
  return pts;
}
const px = (f) => Math.round(20 + f * 570);
const py = (f) => Math.round(125 - Math.min(f, 1.05) * 105);

function revenueHtml(d2resp, P) {
  const sp = (d2resp?.d2?.goals || []).find((g) => g.key === 'sponsors');
  const m = one(sp?.month);
  const has = num(m?.actual);
  const target = num(m?.target) ? m.target : null;
  let pill = '';
  if (has && num(m.pace)) {
    const diff = Math.round(m.actual - m.pace);
    pill = `<span class="pill ${PILL[toneOf(m.status)] || ''} sp">${diff < 0 ? `${esc(usd(-diff))} behind pace` : `${esc(usd(diff))} ahead of pace`}</span>`;
  }
  const big = has
    ? `<b class="num" style="font-size: 52px">${esc(usd(m.actual))}</b>${target ? `<span class="dim" style="font-size: 16px">of ${esc(usd(target))} in ${esc(P.monthName)}</span>` : ''}`
    : `<b class="num nf">${m ? 'No data' : 'No feed'}</b>`;
  const bar = has && target ? `<span class="bar" style="height: 10px; border-radius: 5px"><i style="width: ${Math.min(100, Math.round((m.actual / target) * 100))}%; border-radius: 5px"></i>${num(m.pace) ? `<b style="left: ${Math.min(100, Math.round((m.pace / target) * 100))}%"></b>` : ''}</span>` : '';
  const series = has ? stepSeries(sp.cashDays, P, target) : null;
  const tx = px(P.monthT);
  const deposits = sp?.cashDays ? Object.values(sp.cashDays).filter((v) => Number(v) > 0).length : null;
  const daysLeft = d2resp?.d2?.period?.month?.daysLeft;
  const stat = (l, v) => `<div class="stack"><span class="mut">${l}</span>${v == null ? '<span class="krv nf">No feed</span>' : `<span class="krv">${esc(v)}</span>`}</div>`;
  return `<section class="card" style="flex: 3 1 440px">
<div class="hd cardhd"><span class="chip">${icon('money')}</span><h2>Sponsor Revenue</h2>${pill}</div>
<div class="hd" style="align-items: baseline; gap: 8px; flex-wrap: wrap">${big}</div>
${bar}
<div class="inner" style="gap: 6px">
<svg viewBox="0 0 600 130" role="img" aria-label="Collected against pace" style="display: block; width: 100%; height: auto">
<line class="ax" x1="20" y1="125" x2="590" y2="125"></line>
${target ? '<line class="pace" x1="20" y1="125" x2="590" y2="20"></line>' : ''}
${series ? `<polyline class="act" points="${series.map(([x, y]) => `${px(x)},${py(y)}`).join(' ')}"></polyline>` : ''}
<line class="today" x1="${tx}" y1="22" x2="${tx}" y2="125"></line>
<text x="${tx}" y="14">today</text>
</svg>
<div class="mut" style="display: flex; justify-content: space-between; font-size: 12px"><span>${esc(P.mo.x0)}</span><span>${esc(P.mo.x1)}</span></div>
</div>
<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px">
${stat('Pace today', has && num(m.pace) ? usd(m.pace) : null)}
${stat('Forecast', null)}
${stat('Days left', num(daysLeft) ? String(daysLeft) : null)}
${stat('Deposit days', num(deposits) ? String(deposits) : null)}
</div>
</section>`;
}

const moneyTile = (d2resp, prefix) => (d2resp?.d2?.money?.tiles || []).find((t) => String(t.label || '').startsWith(prefix)) || null;
const hasValue = (t) => t && t.value && !/^no data$/i.test(String(t.value));

function incomeHtml(d2resp, P, bankStale) {
  const m = one((d2resp?.d2?.goals || []).find((g) => g.key === 'sponsors')?.month);
  const vv = moneyTile(d2resp, 'Viral View MRR');
  const row = (tone, label, v, style = '') => `<div class="hrow"${style}><span class="dot ${tone}"></span><span class="ell">${esc(label)}</span>${v == null ? NF : `<b>${esc(v)}</b>`}</div>`;
  return `<section class="card" style="flex: 2 1 300px; gap: 4px">
<div class="hd cardhd" style="margin-bottom: 10px"><span class="chip"><svg class="ic" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 20V10"></path><path d="M10 20V4"></path><path d="M16 20v-7"></path><path d="M22 20H2"></path></svg></span><h2>Income and profit</h2></div>
${row(num(m?.actual) ? 'g' : '', 'Sponsors collected', num(m?.actual) ? usd(m.actual) : null)}
${row(hasValue(vv) ? 'y' : '', `Viral View MRR${vv?.sub ? ` · ${vv.sub}` : ''}`, hasValue(vv) ? vv.value : null)}
${row('', 'YouTube ads', null)}
${row('', 'Affiliates', null)}
${row(bankStale ? 'r' : '', bankStale ? 'Expenses · bank feed stale' : 'Expenses', null, ' style="border-top: 1px solid var(--line); margin-top: 8px; padding-top: 8px"')}
${row('', `Team cost · ${P.monthShort} 1–${P.day}`, null)}
<div class="stack" style="margin-top: auto; padding-top: 14px; gap: 2px"><span class="mut">Profit this month</span><span class="num nf" style="font-size: 32px">No data</span><span class="mut" style="font-size: 12px">needs the expenses feed</span></div>
</section>`;
}

function dealsHtml(d2resp) {
  const st = dealStages(d2resp);
  if (!st) {
    return `<section class="card"><div class="hd cardhd"><span class="chip">${icon('board')}</span><h2>Sponsor deals</h2><span class="mut">by stage</span></div><p class="mut">No feed: the Sponsors board could not be read.</p></section>`;
  }
  const sends = st.reduce((n, s) => n + s.deals.filter((d) => d.draft).length, 0);
  const cols = st.map((s) => {
    const cards = s.deals.slice(0, 8).map((d) => `<div class="vcard" style="gap: 4px"><span style="font-weight: 500; overflow-wrap: anywhere">${esc(d.name)}</span>${d.amt ? `<span class="krv" style="font-size: 15px">${esc(usd(d.amt))}</span>` : ''}${d.note ? `<span class="hd mut" style="gap: 6px; font-size: 12px"><span class="dot ${d.tone}" style="width: 7px; height: 7px"></span>${esc(d.note)}</span>` : ''}</div>`).join('');
    const more = s.deals.length > 8 ? `<span class="mut" style="font-size: 12px">+${s.deals.length - 8} more</span>` : '';
    return `<div class="stage">
<div class="hd" style="justify-content: space-between; gap: 4px"><b class="ell" style="font-size: 13px">${esc(s.name)}</b><span class="krv">${s.deals.length}</span></div>
${cards}${more}${s.deals.length ? '' : '<span class="mut" style="font-size: 12px">None yet</span>'}
</div>`;
  }).join('\n');
  return `<section class="card">
<div class="hd cardhd"><span class="chip">${icon('board')}</span><h2>Sponsor deals</h2><span class="mut">by stage</span>${sends ? `<span class="pill warn sp">${sends} need${sends === 1 ? 's' : ''} your send</span>` : ''}</div>
<div class="board" style="grid-template-columns: repeat(6, minmax(0, 1fr))">
${cols}
</div>
</section>`;
}

function costHtml(d3resp, P) {
  const d3 = d3resp?.d3 || {};
  const tk = d3.rail?.tokens;
  const pct = num(tk?.pct) ? tk.pct : null;
  const tw = d3.goals?.tokenWeeks;
  const hit = Array.isArray(tw?.hitDays) ? tw.hitDays : null;
  const hitText = hit == null ? '' : hit.length ? `limit hit ${andList(hit.map((d) => shortDay(d)))}` : 'limit not hit this month';
  const pill = pct == null ? '' : `<span class="pill ${PILL[tk.state] || ''} sp">${esc(tk.text)}</span>`;
  const pips = Array.from({ length: 10 }, (_, i) => `<i class="pip${pct != null && i < Math.round(pct / 10) ? ' f' : ''}"></i>`).join('');
  const names = (d3.team?.bots || []).map((b) => (b.names || [])[0]).filter(Boolean);
  const bots = names.length
    ? names.map((n) => `<div class="hd" style="gap: 12px"><span style="width: 72px; flex: none; font-weight: 500" class="ell">${esc(n)}</span><span class="bar" style="flex: 1"></span><span class="krv nf" style="width: 64px; flex: none; text-align: right; font-size: 13px">No feed</span></div>`).join('\n')
    : '<p class="mut">No feed: the team roster could not be read.</p>';
  const box = (label, sub) => `<div class="inner" style="gap: 2px"><div class="hd"><span class="mut">${label}</span><span class="krv nf sp" style="font-size: 15px">No feed</span></div><span class="mut" style="font-size: 12px">${sub}</span></div>`;
  return `<section class="card">
<div class="hd cardhd"><span class="chip">${icon('bolt')}</span><h2>Team cost</h2><span class="mut">four ways</span>${pill}</div>
<div class="row" style="gap: 16px">
<div class="stack" style="flex: 3 1 380px; gap: 10px">
<span class="mut">Per bot · ${esc(P.monthShort)} 1–${esc(P.day)}</span>
${bots}
</div>
<div class="stack" style="flex: 2 1 260px; gap: 12px">
<div class="inner" style="gap: 8px"><div class="hd"><span class="mut">Weekly tokens</span>${pct == null ? '<span class="krv nf sp">No feed</span>' : `<span class="krv sp">${pct}%</span>`}</div><span class="pips" aria-hidden="true">${pips}</span>${hitText ? `<span class="mut" style="font-size: 12px">${esc(hitText)}</span>` : ''}</div>
${box('Bots messaging bots', 'needs cost per run')}
${box('Per finished video', 'needs cost per run and finished videos')}
${box('Per project', 'needs tokens saved on every run')}
</div>
</div>
</section>`;
}

export function renderMoney(d2resp, d3resp) {
  const P = periodOf(d2resp);
  const asOf = Date.parse(d2resp?.asOf);
  const read = Number.isFinite(asOf)
    ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/Vancouver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(asOf))
    : '';
  const head = headerOnly(d2resp, 'Money', 'Sponsors · other income · team cost', read ? `<span class="pill sp">Numbers as read ${esc(read)}</span>` : '');
  const m = one((d2resp?.d2?.goals || []).find((g) => g.key === 'sponsors')?.month);
  const st = dealStages(d2resp);
  const agreed = st ? st.find((s) => s.name === 'Agreed').deals : null;
  const priced = agreed ? agreed.filter((d) => d.amt) : [];
  const vv = moneyTile(d2resp, 'Viral View MRR');
  const bank = moneyTile(d2resp, 'Bank feed');
  return `${head}
<div class="row">
${tile('Collected', num(m?.target) ? `of ${usd(m.target)}` : 'this month', num(m?.actual) ? usd(m.actual) : null)}
${tile('Agreed, not invoiced', agreed ? (priced.length ? priced.map((d) => d.name).join(', ') : 'no priced deal agreed') : '', agreed ? usd(priced.reduce((n, d) => n + d.amt, 0)) : null)}
${tile('Viral View', hasValue(vv) ? `MRR${vv.sub ? ` · ${vv.sub}` : ''}` : 'MRR', hasValue(vv) ? vv.value : null)}
${tile('Team cost', `${P.monthShort} 1–${P.day}`, null)}
</div>
<div class="row">
${revenueHtml(d2resp, P)}
${incomeHtml(d2resp, P, !!bank?.source?.stale)}
</div>
${dealsHtml(d2resp)}
${costHtml(d3resp, P)}`;
}
