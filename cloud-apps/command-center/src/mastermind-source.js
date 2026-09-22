export const WINDOW_MS = 24 * 60 * 60 * 1000;
export const PAGE_LIMIT = 100;
export const GROUP_NAME = 'Built With AI - Advanced';
export const ORIGIN = 'telegram-group';

export const CONNECTOR = 'Jonmac_JarvisBot is a DM bridge (privacy mode on, one allowed chat, no group id). Add a different bot to Built With AI - Advanced, disable that bot\'s privacy mode, and set TELEGRAM_GROUP_BOT_TOKEN and TELEGRAM_GROUP_CHAT_ID on the worker. Do not reuse the DM bridge token or call getUpdates on it. Bot API has no getChatHistory; messages from before the bot joins are unavailable, and unconfirmed updates last about 24 hours.';

const VERB = /\b(should|try|use|switch|stop|start|build|ship|pause|fix|replace|add|drop|test)\b/i;
const INJECTION = /ignore (?:all |any )?(?:previous|prior|above) instructions|disregard (?:all |your )?instructions|you are now|<\s*\/?\s*system\s*>|sendMessage\s*\(|TELEGRAM_BOT_TOKEN|bot token is/i;

export function inWindow(ts, nowMs, windowMs = WINDOW_MS) {
  const t = Number(ts);
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return false;
  return t >= nowMs - windowMs && t <= nowMs;
}

export function takePages(pages, limit = PAGE_LIMIT) {
  const seen = new Set();
  const out = [];
  for (const page of pages || []) {
    let fresh = 0;
    for (const item of page || []) {
      const id = item?.update_id ?? item?.id;
      if (seen.has(id)) continue;
      seen.add(id);
      fresh += 1;
      out.push(item);
    }
    if ((page || []).length < limit || fresh === 0) break;
  }
  return out;
}

export function messageLink(chatId, messageId) {
  const id = String(chatId || '');
  if (!id.startsWith('-100') || !messageId) return '';
  return `https://t.me/c/${id.slice(4)}/${messageId}`;
}

export function visible(text) {
  return String(text || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}

export function isInjection(text) {
  return INJECTION.test(visible(text));
}

export function messageFromUpdate(update, groupChatId) {
  const msg = update?.message || update?.channel_post;
  if (!msg || String(msg.chat?.id) !== String(groupChatId)) return null;
  const text = visible(msg.text || msg.caption || '');
  if (!text) return null;
  const from = msg.from || {};
  const author = from.username
    ? `@${String(from.username).replace(/[^\w]/g, '')}`
    : [from.first_name, from.last_name].filter(Boolean).join(' ') || 'unknown';
  const raw = Number(msg.date);
  const ts = raw > 1e12 ? raw : raw * 1000;
  if (!Number.isFinite(ts)) return null;
  return {
    id: `${msg.chat.id}:${msg.message_id}`,
    messageId: msg.message_id,
    chatId: msg.chat.id,
    author,
    text,
    ts,
    link: messageLink(msg.chat.id, msg.message_id),
  };
}

export function dedupe(messages) {
  const seen = new Set();
  const out = [];
  for (const m of messages || []) {
    const key = m?.id || `${m?.author}|${m?.ts}|${m?.text}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

export function mergeWindow(prior, incoming, nowMs) {
  return dedupe([...(prior || []), ...(incoming || [])]).filter((m) => inWindow(m.ts, nowMs));
}

function shortId(text) {
  let h = 0;
  for (const c of String(text)) h = Math.imul(h, 31) + c.charCodeAt(0) | 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

function area(text) {
  const t = text.toLowerCase();
  if (t.includes('instantly') || t.includes('outreach') || t.includes('bounce')) return 'Outreach';
  if (t.includes('sponsor')) return 'Sponsors';
  if (t.includes('meta') || t.includes(' ad') || t.includes('ads')) return 'Viral View';
  if (t.includes('post') || t.includes('content')) return 'Content';
  return 'Mastermind';
}

function titleOf(text) {
  if (text.length <= 80) return text;
  const cut = text.slice(0, 77);
  const sp = cut.lastIndexOf(' ');
  return `${sp > 40 ? cut.slice(0, sp) : cut}…`;
}

export function rankIdeas(messages) {
  const ideas = [];
  for (const m of messages || []) {
    const text = visible(m.text);
    if (!text || isInjection(text) || text.length < 40 || !VERB.test(text)) continue;
    const at = new Date(m.ts).toISOString();
    ideas.push({
      id: shortId(m.id || text),
      area: area(text),
      title: titleOf(text),
      text,
      verdict: text.length >= 80 ? 'implement' : 'park',
      author: m.author || 'unknown',
      messageAt: at,
      link: m.link || '',
      lines: [`${m.author || 'unknown'} · ${at}`, m.link].filter(Boolean),
    });
  }
  ideas.sort((a, b) => (a.verdict === 'implement' ? 0 : 1) - (b.verdict === 'implement' ? 0 : 1) || String(b.messageAt).localeCompare(String(a.messageAt)));
  return ideas.slice(0, 5);
}

export function unavailable(error, nowMs) {
  return {
    origin: ORIGIN,
    access: 'unavailable',
    error: String(error || CONNECTOR),
    connector: CONNECTOR,
    scanned: 0,
    picks: [],
    messages: [],
    scannedAt: new Date(nowMs).toISOString(),
    empty: false,
    history: 'none',
  };
}
