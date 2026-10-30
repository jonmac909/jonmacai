import { isSandbox } from './payment-config.js';

// Resend's test sink: logged as delivered in Resend, never sent to a real inbox.
export const SANDBOX_REMINDER_RECIPIENT = 'delivered@resend.dev';
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

// One live session only (Jon, Oct 20): Thu Oct 29 2026, 7 PM ET. public/schedule.js
// uses the same times. Sales close at 5:30 PM PT / 8:30 PM ET (Jon, Oct 21), 90 minutes into
// the session. Anyone who pays after that gets the recording and a refund offer (L1) instead of
// reminders. Anyone who pays while the session is live gets the join link at once (E6).
export const SESSION_AT = Date.UTC(2026, 9, 29, 23, 0, 0);
export const SALES_CLOSE = Date.UTC(2026, 9, 30, 0, 30, 0);
export const salesClosed = (at = Date.now()) => at >= SALES_CLOSE;

export function assignSession(purchasedAt) {
  const at = new Date(purchasedAt).getTime();
  if (!Number.isFinite(at)) throw new Error('invalid_purchase_time');
  return {
    session_at: new Date(SESSION_AT).toISOString(),
    session_label: new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(new Date(SESSION_AT)),
    ...(salesClosed(at) ? { closed: true } : {}),
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

// Read links at send time, so Zoom and replay URLs set after booking still reach buyers.
export function reminderLinks(env) {
  return { join: configuredUrl(env.CLONE_ZOOM_JOIN_URL, true), replay: configuredUrl(env.CLONE_REPLAY_URL) };
}
const NEEDS = { E4: 'join', E5: 'join', E6: 'join', E7: 'join', E8: 'replay', L1: 'replay' };
export const replayStep = step => NEEDS[step] === 'replay';
export function missingLink(step, links) {
  return NEEDS[step] && !links[NEEDS[step]] ? `missing_${NEEDS[step]}_url` : null;
}

export function reminderPlan({ transaction_ref, purchased_at, session_at }, env, now = Date.now()) {
  const session = Date.parse(session_at);
  if (!Number.isFinite(session) || !Number.isFinite(purchased_at)) throw new Error('invalid_session');
  const links = reminderLinks(env);
  const live = purchased_at >= session;
  const candidates = salesClosed(purchased_at) ? [['L1', purchased_at + (isSandbox(env) ? 3 * 60 * 1000 : 0)]] : [
    ['E1', purchased_at + (isSandbox(env) ? 3 * 60 * 1000 : 0)], ['E2', session - 24 * HOUR],
    ['E3', easternTime(session, 0, 9)], ['E4', session - HOUR],
    ['E5', session - 10 * 60 * 1000], ['E6', live ? purchased_at : session],
    ['E7', session + 15 * 60 * 1000], ['E8', easternTime(session, 1, 9)],
  ];
  return candidates.map(([step, at]) => {
    const liveJoin = live && step === 'E6', immediate = ['E1', 'L1'].includes(step) || liveJoin;
    return {
      step, scheduled_at: liveJoin || (immediate && !isSandbox(env)) ? null : new Date(at).toISOString(),
      idempotency_key: `${transaction_ref}-${step}`, ...links,
      skip: step === 'E2' && session - purchased_at <= 24 * HOUR ? 'within_24_hours' :
        !liveJoin && (!immediate || isSandbox(env)) && at <= now ? 'past' : null,
      // Held, not skipped: the scheduler sends it once the link is configured.
      awaiting: missingLink(step, links),
    };
  });
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
  const reminder = plan.step === 'L1' ? null : plan.step === 'E8' ? `Your session was ${session.session_label}. The recording is yours to revisit.` :
    `Your live training: ${session.session_label}. Join from a computer.`;
  const copy = {
    E1: ["you're in", `Hey,\n\nQuick story. The people who win on TikTok Shop are rarely the most creative. They found something already selling and moved while it was hot.\n\nWinning videos are public. You can see what sells and why.\n\nThat's the Clone Method. No big following, no camera. One product, one structure that works.\n\n[Put the session on your calendar](${calendarUrl(session.session_at)})\n\nJon`],
    E2: ["followers", `Hey,\n\nA follower count says almost nothing about whether a video can sell.\n\nTikTok Shop tests your video on strangers. If it sells, it shows it to more strangers. It doesn't care who follows you.\n\nSo the question isn't how to get followers. It's how to make a video that sells.\n\nReply and tell me what you sell. I read these.\n\nJon`],
    E3: ["here's what we're building tonight", `Hey,\n\nTonight we build.\n\nWe'll pick a product, study a winning example together, and build your first clone while I'm there to correct you. Not a theory session. A working session.\n\nBy the end you'll have a draft you can test this week.\n\nBring a laptop and an idea. If you do not have a product picked yet, that is fine. We'll find one.\n\nSee you tonight.\n\nJon`],
    E4: ["your link for tonight", `Hey,\n\n[Here's your link for tonight](${plan.join})\n\nOpen it on a computer and check that Zoom works before we start. Give yourself five minutes so you're not fighting with audio while everyone else is building.\n\nHave somewhere to take notes, and have your product idea nearby.\n\nTalk soon,\nJon`],
    E5: ["we start in 10 minutes", `Hey,\n\nWe start in 10 minutes.\n\nGrab your laptop, open Zoom and get comfortable. We'll pick the product first, then build it together.\n\n[Join the live session](${plan.join})\n\nSee you inside.\n\nJon`],
    E6: ["we're live", `Hey,\n\nWe're live.\n\nCome in. Bring your draft if you started one, or just follow along while we build the first one from scratch.\n\n[Join the live session](${plan.join})\n\nJon`],
    E7: ["if the link won't open", `Hey,\n\n[A few people have had trouble with the link, so here it is again](${plan.join})\n\nIf it's still not working, reply and tell me exactly what you see on your screen. I'll help you sort it out.\n\nJon`],
    E8: ["your replay is here", `Hey,\n\n[The replay is ready](${plan.replay})\n\nHere's my advice, and I mean it. Watch the part you need, then go finish one draft. Just one.\n\nOne finished, tested video will teach you more than a folder full of half finished ideas.\n\nWhen you post it, reply and tell me how it went. I read every one.\n\nTalk soon,\nJon`],
    L1: ['Your Clone Method recording', `Thanks for your order. Registration for the live Clone Method session on ${session.session_label} closed before your order came in, so there isn't a live seat to give you.\n\nHere's the full recording:\n${plan.replay}\n\nIf you'd rather not keep it, reply to this email and I'll refund your $47 in full.`],
  };
  const [subject, body] = copy[plan.step];
  const unsubscribe = `https://jonmac.ai/clone/api/reminders/unsubscribe?token=${encodeURIComponent(session.unsubscribe_token)}${isSandbox(env) ? '&sandbox=1' : ''}`;
  // Bodies use [anchor](url) links; plain text shows "anchor:" then the URL, HTML shows the anchor only.
  const closing = plan.step === 'L1' ? '— Jon\n\n' : '';
  const source = `${body}\n\n${reminder ? reminder + '\n\n' : ''}${closing}[Unsubscribe from webinar reminders](${unsubscribe})`;
  const text = source.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1:\n$2');
  const html = '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;max-width:600px">' +
    source.split('\n\n').map(p => `<p>${escapeHtml(p).replace(/\[([^\]]+)\]\((https:[^)\s]+)\)|(https:\/\/[^\s<]+)/g, (m, anchor, linked, bare) => anchor ? `<a href="${linked}">${anchor}</a>` : `<a href="${bare}">${bare}</a>`).replace(/\n/g, '<br>')}</p>`).join('') + '</div>';
  return {
    from: env.RESEND_FROM || 'Jon Mac <support@viralview.io>', to: isSandbox(env) ? SANDBOX_REMINDER_RECIPIENT : session.email,
    reply_to: env.RESEND_REPLY_TO || 'jon@thejonmac.com', subject: (isSandbox(env) ? '[SANDBOX TEST] ' : '') + subject, text, html,
    ...(plan.scheduled_at ? { scheduled_at: plan.scheduled_at } : {}),
    headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{ name: 'campaign', value: 'clone-webinar' }, { name: 'step', value: plan.step }],
  };
}
