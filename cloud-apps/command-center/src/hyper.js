// Dashboard 3 Hyper page (docs/dashboard-3.md): Jon's session gets a 60-second ticket that opens the HyperFrames app
// at hyper.jonmac.ai. That host's own Worker (cloud-apps/hyper) asks /dashboard/api/hyper/check before it lets
// anyone in, so the app trusts only a dashboard sign-in. The dashboard cookie itself never leaves jonmac.ai.
import { hmacHex, timingSafeEqualString } from './auth.js';

export const HYPER_ORIGIN = 'https://hyper.jonmac.ai';
export const TICKET_SECONDS = 60;

// "hyper." keeps a ticket from ever passing as a session ("<exp>") or a Google state ("gcal.<exp>").
const sign = (env, exp) => hmacHex(env.SESSION_SECRET, `hyper.${exp}`);

export async function hyperTicket(env, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + TICKET_SECONDS;
  return `${exp}.${await sign(env, exp)}`;
}

export async function hyperTicketOk(env, ticket, nowMs = Date.now()) {
  const m = /^(\d{1,12})\.([0-9a-f]{64})$/.exec(String(ticket || ''));
  if (!m || !env.SESSION_SECRET) return false;
  if (!timingSafeEqualString(m[2], await sign(env, m[1]))) return false;
  const exp = Number(m[1]) * 1000;
  // Not expired, and never dated further ahead than a ticket can be.
  return nowMs < exp && exp - nowMs <= TICKET_SECONDS * 1000;
}

// What the Hyper page loads in its frame: the app's entry address with a fresh ticket.
export async function hyperEntry(env, nowMs = Date.now()) {
  const origin = env.HYPER_ORIGIN || HYPER_ORIGIN;
  return { origin, url: `${origin}/__enter?t=${await hyperTicket(env, nowMs)}`, seconds: TICKET_SECONDS };
}
