export const RENDER_MISSING = 'Render worker is not connected. No preview was generated.';

export function buildRemakeProject({ row, templateId, templates = [], id, createdAt } = {}) {
  if (!row || !row.id) return { ok: false, error: 'Source video is not loaded. Sync live YouTube or pick another card.' };
  const template = templates.find((item) => item.id === templateId) || templates[0];
  if (!template?.id) return { ok: false, error: 'Select a template' };
  return {
    ok: true,
    project: {
      id: id || `v2_${row.id}_${template.id}`,
      origin: 'yt2',
      createdAt: createdAt || new Date().toISOString(),
      source: {
        id: row.id,
        title: row.title,
        thumbnail: row.thumbnail,
        channel: row.channel,
        views: row.views,
        outlier_score: row.outlier_score,
        url: row.url,
      },
      templateId: template.id,
      stage: 'plan',
      missing: ['script LLM', 'render worker'],
    },
  };
}

export function editWithoutRenderer() {
  return {
    status: 'unavailable',
    progress: 0,
    currentJob: RENDER_MISSING,
    missing: ['render worker'],
  };
}

export function pickTemplate({ queryTemplate, stored, sourceId, recommended } = {}) {
  const saved = stored && sourceId ? stored[sourceId] : '';
  return queryTemplate || saved || recommended || '';
}

export function rememberTemplate(stored, sourceId, templateId) {
  const next = { ...(stored || {}) };
  if (sourceId && templateId) next[sourceId] = templateId;
  return next;
}
