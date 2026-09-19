const PILL = {
  scanned: ['Scanned', 'ok'],
  needs_code: ['Needs code', 'warn'],
  code_expired: ['Code timed out', 'crit'],
  running: ['Scanning', 'blue'],
  failed: ['Failed', 'crit'],
  pending: ['Waiting', ''],
};

function age(collectedAt, nowMs) {
  const t = Date.parse(collectedAt);
  if (!Number.isFinite(t)) return 'updated just now';
  const m = Math.floor(Math.max(0, nowMs - t) / 60000);
  if (m < 1) return 'updated just now';
  if (m === 1) return 'updated 1 min ago';
  if (m < 60) return `updated ${m} min ago`;
  const h = Math.floor(m / 60);
  return h === 1 ? 'updated 1 hr ago' : `updated ${h} hr ago`;
}

export function scrubBankScan(data = {}) {
  const { password, code, secret, token, login, accounts, ...rest } = data;
  return {
    ...rest,
    accounts: (accounts || []).map((a) => {
      const { password: p, code: c, secret: s, token: t, login: l, ...row } = a;
      return row;
    }),
  };
}

function rowFor(a) {
  const [pill, pillCls] = PILL[a.status] || PILL.pending;
  const scanned = a.scanned ?? 0;
  const total = a.total ?? 0;
  const row = {
    title: a.title,
    sub: a.status === 'needs_code'
      ? `${scanned} of ${total} scanned · waiting on a text code`
      : a.status === 'code_expired'
        ? `${scanned} of ${total} scanned · code timed out`
        : `${scanned} of ${total} scanned`,
    pill,
    pillCls,
  };
  if (a.status === 'needs_code') {
    row.btn = 'Enter code';
    row.kind = 'bank.submit_code';
    row.payload = { account: a.id };
  } else if (a.status === 'code_expired') {
    row.btn = 'Try again';
    row.kind = 'bank.scan_now';
    row.payload = { account: a.id };
  }
  return row;
}

export function overlayBankScan(page, data, collectedAt, nowMs) {
  const accounts = data.accounts || [];
  if (!accounts.length) return page;
  const done = accounts.reduce((n, a) => n + (a.status === 'scanned' ? (a.scanned ?? a.total ?? 0) : (a.scanned || 0)), 0);
  const total = accounts.reduce((n, a) => n + (a.total || 0), 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = age(collectedAt, nowMs);
  page.bankScan = {
    ...page.bankScan,
    meta: `${done} of ${total} accounts · ${label}`,
    pct,
    pg: pct >= 100 ? 'ok' : 'risk',
    rows: accounts.map(rowFor),
  };
  page.actions = (page.actions || []).map((a) => (
    a.label === 'Scan banks now'
      ? { label: 'Scan banks now', kind: 'bank.scan_now', payload: { msg: 'Bank scan started' } }
      : a
  ));
  page.sub = `Bank scan · ${label}`;
  return page;
}
