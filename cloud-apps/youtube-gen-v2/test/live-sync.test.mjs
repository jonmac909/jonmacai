import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchLiveYoutubeRefresh, LOGIN_HREF, YT_REFRESH_URL } from '../live-sync.js';
import { buildRemakeProject, editWithoutRenderer, RENDER_MISSING } from '../remake.js';

function jsonRes(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra.headers },
  });
}

test('sync posts /yt/api/channels/refresh with cookies, not the yt2 proxy', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return jsonRes({ ok: true, rows: [{ id: 'v1', title: 'AI UGC ads' }], generatedAt: '2026-09-19T00:00:00Z', refreshed: [{ name: 'Ch' }] });
  };
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, YT_REFRESH_URL);
  assert.equal(YT_REFRESH_URL, '/yt/api/channels/refresh');
  assert.ok(YT_REFRESH_URL.startsWith('/yt/'), 'Path=/yt cookies only attach under /yt');
  assert.equal(calls[0].url.includes('/yt2/api/refresh'), false);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].id, 'v1');
  assert.equal(result.needLogin, false);
});

test('307 login redirect is needLogin back to yt2, not success', async () => {
  const fetchImpl = async () => new Response(null, {
    status: 307,
    headers: { location: '/yt/login?next=/api/channels/refresh' },
  });
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.needLogin, true);
  assert.equal(result.login, LOGIN_HREF);
  assert.equal(LOGIN_HREF, '/yt/login?next=/yt2/');
  assert.equal(Array.isArray(result.rows) && result.rows.length > 0, false);
});

test('HTML login page is needLogin, not parsed as rows', async () => {
  const fetchImpl = async () => new Response('<html>AIOS Hub</html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.needLogin, true);
  assert.equal(result.login, LOGIN_HREF);
});

test('JSON without a row list is not success', async () => {
  const fetchImpl = async () => jsonRes({ ok: true, status: 'logged-in' });
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.needLogin, false);
  assert.equal(Array.isArray(result.rows) && result.rows.length > 0, false);
});

test('upstream videos[] maps to rows', async () => {
  const fetchImpl = async () => jsonRes({ ok: true, videos: [{ id: 'v2', title: 'AI video generation' }] });
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].id, 'v2');
});

test('JSON error is not success and not login', async () => {
  const fetchImpl = async () => jsonRes({ ok: false, error: 'quota' }, 200);
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(result.ok, false);
  assert.equal(result.needLogin, false);
  assert.match(result.error, /quota/);
});

test('5xx retries once then returns actual rows', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return jsonRes({ error: 'upstream' }, 502);
    return jsonRes({ ok: true, rows: [{ id: 'v3', title: 'AI UGC' }] });
  };
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(n, 2);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].id, 'v3');
});

test('login 307 does not retry the paid refresh', async () => {
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    return new Response(null, { status: 307, headers: { location: '/yt/login?next=/api/channels/refresh' } });
  };
  const result = await fetchLiveYoutubeRefresh(fetchImpl);
  assert.equal(n, 1);
  assert.equal(result.needLogin, true);
  assert.equal(result.ok, false);
});

const templates = [{ id: 'trend_to_revenue' }, { id: 'brand_build' }, { id: 'model_battle' }];

test('remake persists the requested template and source, not the default', () => {
  const row = { id: 'abc', title: 'AI UGC ads', channel: 'X', views: 1, outlier_score: 4, thumbnail: 't', url: 'u' };
  const result = buildRemakeProject({ row, templateId: 'brand_build', templates });
  assert.equal(result.ok, true);
  assert.equal(result.project.templateId, 'brand_build');
  assert.equal(result.project.source.id, 'abc');
  assert.equal(result.project.origin, 'yt2');
});

test('remake without a loaded source is not a fake project', () => {
  const result = buildRemakeProject({ row: null, templateId: 'brand_build', templates });
  assert.equal(result.ok, false);
  assert.equal(result.project, undefined);
});

test('absent renderer is reported and is not a finished review', () => {
  const edit = editWithoutRenderer();
  assert.equal(edit.status, 'unavailable');
  assert.equal(edit.progress, 0);
  assert.match(edit.currentJob, /not connected/i);
  assert.ok(edit.missing.includes('render worker'));
  assert.equal(edit.status === 'review' || edit.status === 'rendering', false);
  assert.equal(RENDER_MISSING.includes('not connected'), true);
});
