const STEP_NAME = ['', 'uploaded, waiting its turn', 'rough cut', 'adding graphics', 'sound', 'export'];

export function overlayVideo(page, data = {}) {
  const queue = data.queue || [];
  const editing = queue.filter((q) => q.status === 'editing' || q.status === 'queued' || q.status === 'waiting');
  const ready = queue.filter((q) => q.status === 'ready');
  const finished = queue.filter((q) => q.status === 'done');
  const nEdit = queue.filter((q) => q.status === 'editing').length;
  page.sub = `${nEdit} editing now · ${ready.length} ready for you to watch`;
  page.editing = {
    ...page.editing,
    rows: editing.map((q) => {
      const step = Number(q.step) || 1;
      const steps = Number(q.steps) || 5;
      const name = STEP_NAME[step] || 'working';
      const eta = Number(q.etaMinutes) || 0;
      const waiting = q.status === 'queued';
      const review = q.stage === 'waiting-for-review';
      return {
        title: q.title,
        sub: q.host && q.stage
          ? `${q.host} · ${q.stage}${q.failure ? ` · ${q.failure}` : ''}`
          : waiting
          ? `Step ${step} of ${steps} · ${name}`
          : `Step ${step} of ${steps} · ${name}${eta ? ` · about ${eta} minutes left` : ''}`,
        pct: Number(q.progress) || 0,
        pill: q.failure ? 'Failed' : review ? 'Review' : waiting ? 'Queued' : 'Editing',
        pillCls: q.failure ? 'crit' : review ? '' : waiting ? '' : 'blue',
        btn: review ? 'Review keepers' : (waiting && !q.failure) ? 'Do this first' : undefined,
        kind: review ? 'video.resume' : (waiting && !q.failure) ? 'video.prioritize' : undefined,
        payload: review ? { actionId: q.actionId, keepers: q.segments || [] } : waiting ? { id: q.id } : undefined,
      };
    }),
  };
  page.ready = {
    ...page.ready,
    rows: ready.map((q) => ({
      title: q.title,
      sub: q.sub || 'Ready to watch',
      href: q.readyPath || undefined,
    })),
  };
  page.finished = {
    ...page.finished,
    rows: finished.map((q) => ({
      video: q.title,
      finished: q.finishedAt || 'This week',
      time: q.editMinutes != null ? `${q.editMinutes} min` : '—',
      where: q.where || 'Exported',
    })),
  };
  page.upload = { ...page.upload, pick: true };
  const ytDone = finished.filter((q) => !/sponsor/i.test(q.title || '')).length;
  const spCuts = [...finished, ...ready].filter((q) => /sponsor/i.test(q.title || '')).length;
  const live = (Number(data.live) || 0) || ytDone;
  const sponsor = data.sponsorCuts != null ? data.sponsorCuts : spCuts;
  page.target = {
    title: "This week's target",
    rows: [
      { label: 'YouTube videos', value: `${live} of 3`, pct: Math.min(100, Math.round(live / 3 * 100)), tall: true },
      { label: 'Sponsor cuts', value: `${sponsor} of 3`, pct: Math.min(100, Math.round(sponsor / 3 * 100)), tall: true },
    ],
  };
}

