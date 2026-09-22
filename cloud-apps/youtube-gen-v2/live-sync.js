// AIOS Hub (/yt OpenNext) gates POST /yt/api/channels/refresh with 307 → /yt/login.
// Login is POST /yt/api/auth/login. Session cookies are Path-scoped to /yt, so they
// are not sent to /yt2/*. yt2 must POST this URL from the browser with credentials.
export const YT_REFRESH_URL = '/yt/api/channels/refresh';
export const LOGIN_HREF = '/yt/login?next=/yt2/';

export function listedRows(body) {
  if (Array.isArray(body?.rows)) return { rows: body.rows, listed: true };
  if (Array.isArray(body?.refresh?.rows)) return { rows: body.refresh.rows, listed: true };
  if (Array.isArray(body?.videos)) return { rows: body.videos, listed: true };
  if (Array.isArray(body?.items)) return { rows: body.items, listed: true };
  if (Array.isArray(body?.data)) return { rows: body.data, listed: true };
  if (Array.isArray(body?.data?.rows)) return { rows: body.data.rows, listed: true };
  return { rows: [], listed: false };
}

function isLoginResponse(res, contentType) {
  if (res.type === 'opaqueredirect' || res.redirected) return true;
  const s = res.status;
  if (s === 401 || s === 301 || s === 302 || s === 303 || s === 307 || s === 308) return true;
  return (contentType || '').includes('text/html');
}

export function interpretRefreshResponse(res, { body, contentType } = {}) {
  if (isLoginResponse(res, contentType)) {
    return { ok: false, needLogin: true, login: LOGIN_HREF, rows: [], error: 'YouTube login required' };
  }
  let json = body;
  if (typeof body === 'string') {
    try { json = JSON.parse(body); } catch { json = {}; }
  }
  json = json && typeof json === 'object' ? json : {};
  const mapped = listedRows(json);
  if (!res.ok || json.ok === false || !mapped.listed) {
    const status = res.status;
    return {
      ok: false,
      needLogin: false,
      rows: [],
      error: json.error || (res.ok ? 'No video rows' : `Live refresh failed (${status})`),
      retryable: status >= 500 || status === 429,
    };
  }
  return {
    ok: true,
    needLogin: false,
    rows: mapped.rows,
    generatedAt: json.generatedAt,
    refreshed: json.refreshed,
  };
}

async function readBody(res) {
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) return { contentType, body: '' };
  if (contentType.includes('application/json')) {
    return { contentType, body: await res.json().catch(() => ({})) };
  }
  const text = await res.text().catch(() => '');
  if (!text) return { contentType, body: {} };
  try { return { contentType, body: JSON.parse(text) }; } catch { return { contentType, body: { error: text.slice(0, 200) } }; }
}

async function postRefresh(fetchImpl) {
  const res = await fetchImpl(YT_REFRESH_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  });
  const { contentType, body } = await readBody(res);
  return interpretRefreshResponse(res, { body, contentType });
}

export async function fetchLiveYoutubeRefresh(fetchImpl = globalThis.fetch) {
  let first;
  try {
    first = await postRefresh(fetchImpl);
  } catch (err) {
    first = { ok: false, needLogin: false, rows: [], retryable: true, error: err.message || 'Live refresh failed' };
  }
  if (first.ok || first.needLogin || !first.retryable) return first;
  try {
    return await postRefresh(fetchImpl);
  } catch (err) {
    return { ok: false, needLogin: false, rows: [], error: err.message || first.error || 'Live refresh failed' };
  }
}

export async function publishDashboardSync(payload, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl('/yt2/api/sync', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-YT2': '1' },
    body: JSON.stringify({
      rows: payload?.rows || [],
      generatedAt: payload?.generatedAt,
      refreshed: payload?.refreshed || [],
    }),
  });
  if (!res.ok) return { ok: false };
  try { return await res.json(); } catch { return { ok: false }; }
}
