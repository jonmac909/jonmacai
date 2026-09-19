function waitLabel(ms) {
  const m = Math.max(0, Math.floor(Number(ms) / 60000));
  if (m < 1) return 'waited just now';
  if (m === 1) return 'waited 1 minute';
  if (m < 60) return `waited ${m} minutes`;
  const h = Math.floor(m / 60);
  if (h === 1) return 'waited 1 hour';
  if (h < 48) return `waited ${h} hours`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'waited 1 day' : `waited ${d} days`;
}

function waitTile(ms) {
  const m = Math.max(0, Math.floor(Number(ms) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return h === 1 ? '1 hr' : `${h} hrs`;
  const d = Math.floor(h / 24);
  return d === 1 ? '1 day' : `${d} days`;
}

function prettyTitle(subject) {
  return `"${String(subject || '').replace(/^re:\s*/i, '').trim()}"`;
}

function quoteOf(body) {
  const text = String(body || '').replace(/\s+/g, ' ').trim();
  const clip = text.length > 90 ? `${text.slice(0, 87).replace(/\s+\S*$/, '')}…` : text;
  return `Draft: ${clip}`;
}

function payloadOf(t, extra = {}) {
  return {
    uid: String(t.uid || t.id || ''),
    to: t.to || '',
    subject: t.subject || '',
    body: t.body || '',
    inReplyTo: t.inReplyTo || t.in_reply_to || '',
    references: t.references || '',
    ...extra,
  };
}

export function overlaySupport(page, data, nowMs, ageLabel = '') {
  const tickets = data.tickets || [];
  const drafts = tickets.filter((t) => !t.money);
  const money = tickets.filter((t) => t.money);
  const oldest = tickets.reduce((n, t) => Math.max(n, Number(t.waitedMs) || 0), 0);
  const hours = oldest / 3600000;
  const answered = Number(data.answeredToday) || 0;
  const inbound = Number(data.inboundToday) || 0;
  const left = Math.max(0, inbound - answered);
  const refunds = Number(data.refundsThisMonth) || 0;
  const reqN = money.length;
  const checked = ageLabel ? ageLabel.replace(/^updated /, 'checked ') : 'checked just now';
  page.sub = `Email and live chat · ${checked}`;
  page.actions = [{
    label: 'Approve all safe replies',
    kind: 'support.send_all_safe',
    msg: money.length
      ? `${drafts.length} safe replies sent · refund left for you`
      : `${drafts.length} safe replies sent`,
    payload: { ids: drafts.map((t) => String(t.uid)), refundLeft: money.length > 0 },
    primary: true,
  }];
  page.tiles = [
    { icon: 'chat', label: 'Waiting on you', value: String(tickets.length), sub: tickets.length ? 'All have drafted replies' : 'None waiting' },
    {
      icon: 'clock', label: 'Oldest has waited', value: tickets.length ? waitTile(oldest) : '—',
      pct: Math.min(100, Math.round(hours / 24 * 100)), pg: hours < 24 ? 'ok' : 'risk',
      sub: 'Goal: reply within 24 hours',
    },
    {
      icon: 'check', label: 'Answered today', value: String(answered),
      goal: inbound ? `/ ${inbound}` : '', pct: inbound ? Math.min(100, Math.round(answered / inbound * 100)) : 0,
      pg: inbound && answered / inbound < 0.5 ? 'risk' : 'ok',
      sub: left ? `${left} left` : 'Caught up',
    },
    {
      icon: 'dollar', label: 'Refunds this month', value: `$${refunds}`,
      sub: refunds ? `${refunds} this month` : (reqN ? `None yet · ${reqN} request${reqN === 1 ? '' : 's'} open` : 'None yet'),
    },
  ];
  page.drafts = {
    title: 'Drafted replies',
    meta: 'Nothing sends without you',
    rows: drafts.map((t) => ({
      title: prettyTitle(t.subject),
      sub: `${t.plan || 'Email'} · ${waitLabel(t.waitedMs)}`,
      quote: quoteOf(t.body),
      kind: 'support.send',
      payload: payloadOf(t, { msg: 'Reply sent' }),
    })),
  };
  page.money = {
    title: 'Money decisions',
    pill: reqN ? `${reqN} open` : 'None',
    pillCls: reqN ? 'risk' : 'ok',
    rows: money.map((t) => {
      const amt = Number(t.amount) || 0;
      const send = payloadOf(t);
      return {
        title: prettyTitle(t.subject),
        sub: amt ? `Paid $${amt} · ${waitLabel(t.waitedMs)}` : `${t.plan || 'Paid plan'} · ${waitLabel(t.waitedMs)}`,
        decline: 'Decline',
        declineMsg: 'Polite decline sent',
        refund: amt ? `Refund $${amt}` : 'Refund',
        refundMsg: 'Reply sent · refund still in Commas',
        kind: 'support.decide_refund',
        payload: { ...send, decision: 'refund', msg: 'Reply sent · refund still in Commas' },
        declineKind: 'support.decide_refund',
        declinePayload: { ...send, decision: 'decline', msg: 'Polite decline sent' },
      };
    }),
  };
  const topics = data.topics || [];
  const max = Math.max(1, ...topics.map((t) => Number(t.n) || 0));
  const week = Number(data.weekCount) || topics.reduce((n, t) => n + (Number(t.n) || 0), 0);
  const top = topics[0];
  const share = top && week ? Math.round(Number(top.n) / week * 100) : 0;
  page.topics = {
    title: 'What people ask about',
    meta: week ? `This week · ${week} tickets` : 'This week',
    rows: topics.map((t) => ({ label: t.label, value: String(t.n), pct: Math.round((Number(t.n) || 0) / max * 100) })),
    box: top && share >= 30 ? `${top.label} are ${share}% of tickets. Worth a fix.` : 'No one topic is dominating this week.',
  };
}
