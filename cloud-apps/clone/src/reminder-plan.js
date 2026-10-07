const HOUR = 60 * 60 * 1000;
const eastern = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function localParts(at) {
  return Object.fromEntries(eastern.formatToParts(new Date(at)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}

// Resolve a local calendar date instead of adding 24 hours across DST boundaries.
export function easternTime(at, dayOffset, hour) {
  const p = localParts(at);
  const day = new Date(Date.UTC(p.year, p.month - 1, p.day + dayOffset, hour));
  const target = day.getTime();
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const q = localParts(guess);
    guess += target - Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second);
  }
  return guess;
}

export function assignSession(purchasedAt) {
  const at = new Date(purchasedAt).getTime();
  if (!Number.isFinite(at)) throw new Error('invalid_purchase_time');
  let session = easternTime(at, 0, 19);
  if (session - at < 2 * HOUR) session = easternTime(at, 1, 19);
  return {
    session_at: new Date(session).toISOString(),
    session_label: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(session)),
  };
}

function configuredUrl(value, zoom = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password ||
        (zoom && !/(^|\.)zoom\.(us|com)$/.test(url.hostname))) return '';
    return url.href;
  } catch { return ''; }
}

export function reminderPlan({ transaction_ref, purchased_at, session_at }, env, now = Date.now()) {
  const session = Date.parse(session_at);
  if (!Number.isFinite(session) || !Number.isFinite(purchased_at)) throw new Error('invalid_session');
  const candidates = [
    ['E1', purchased_at], ['E2', session - 24 * HOUR],
    ['E3', easternTime(session, 0, 9)], ['E4', session - HOUR],
    ['E5', session - 10 * 60 * 1000], ['E6', session],
    ['E7', session + 15 * 60 * 1000], ['E8', easternTime(session, 1, 9)],
  ];
  const join = configuredUrl(env.CLONE_ZOOM_JOIN_URL, true);
  const replay = configuredUrl(env.CLONE_REPLAY_URL);
  return candidates.map(([step, at]) => ({
    step, scheduled_at: step === 'E1' ? null : new Date(at).toISOString(),
    idempotency_key: `${transaction_ref}-${step}`, join, replay,
    skip: step === 'E2' && session - purchased_at <= 24 * HOUR ? 'within_24_hours' :
      step !== 'E1' && at <= now ? 'past' :
      ['E4', 'E5', 'E6', 'E7'].includes(step) && !join ? 'missing_join_url' :
      step === 'E8' && !replay ? 'missing_replay_url' : null,
  }));
}

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function calendarUrl(sessionAt) {
  const stamp = at => new Date(at).toISOString().replace(/[-:]/g, '').replace('.000', '');
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: 'The Clone Method live training',
    dates: `${stamp(sessionAt)}/${stamp(Date.parse(sessionAt) + 2 * HOUR)}`,
    ctz: 'America/New_York', details: 'Join from a computer. Your join link arrives by email.',
  });
  // Join links stay in email; neither public calendar URLs nor SMS contain them.
  return 'https://calendar.google.com/calendar/render?' + params;
}

export function reminderMessage(session, plan, env) {
  const reminder = plan.step === 'E8' ? `Your session was ${session.session_label}. The recording is yours to revisit.` :
    `Your live training: ${session.session_label}. Join from a computer.`;
  const copy = {
    E1: ["You're in", `The answer key is public. You can see which products sell, which videos work, and what buyers respond to.\n\nThe work is choosing one, building it, and getting it in front of buyers. Winners are on a clock; they act while the opportunity is there. That's what we'll practice together.\n\nAdd it to your calendar:\n${calendarUrl(session.session_at)}`],
    E2: ["Why followers don't matter", "A follower count doesn't tell you whether a video can sell. A clear product, a useful demonstration, and an offer people understand give you something to test.\n\nStart with the buyer's problem. Then make the video answer it. We'll use that approach in the training."],
    E3: ["What we'll build tonight", "Tonight we'll choose a product, study a working example, and build your first clone together. You'll leave with a draft you can test.\n\nBring a computer and an idea. If you don't have a product picked yet, that's fine; we'll work through it."],
    E4: ["Your link for tonight", `Open the link on your computer and check that Zoom works before we begin. Have a place to save your notes and your first draft.\n\nJoin here:\n${plan.join}`],
    E5: ["Starting in 10", `Grab your computer and open Zoom. We'll start with the product and work through the build together.\n\nJoin here:\n${plan.join}`],
    E6: ["We're live", `We're starting. Bring your draft or follow along as we build the first one.\n\nJoin here:\n${plan.join}`],
    E7: ["Trouble joining?", `Here's the link again:\n${plan.join}\n\nIf you're stuck, reply to this email and tell me what you're seeing.`],
    E8: ["Your Clone Method replay", `Rewatch the part you need, then finish one draft before starting another. One completed test will teach you more than a folder of unfinished ideas.\n\nWatch the replay:\n${plan.replay}`],
  };
  const [subject, body] = copy[plan.step];
  const unsubscribe = `https://jonmac.ai/clone/api/reminders/unsubscribe?token=${encodeURIComponent(session.unsubscribe_token)}`;
  const text = `${body}\n\n${reminder}\n\n— Jon\n\nUnsubscribe from webinar reminders:\n${unsubscribe}`;
  const html = '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;max-width:600px">' +
    text.split('\n\n').map(p => `<p>${escapeHtml(p).replace(/https:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`).replace(/\n/g, '<br>')}</p>`).join('') + '</div>';
  return {
    from: env.RESEND_FROM || 'Jon Mac <support@viralview.io>', to: session.email,
    reply_to: env.RESEND_REPLY_TO || 'jon@thejonmac.com', subject, text, html,
    ...(plan.scheduled_at ? { scheduled_at: plan.scheduled_at } : {}),
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{ name: 'campaign', value: 'clone-webinar' }, { name: 'step', value: plan.step }],
  };
}
