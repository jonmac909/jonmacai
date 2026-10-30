// Phone calls to Ana from anywhere (Jon 2026-10-30). GPU1's Grok Voice bridge keeps one outbound
// WebSocket to the CallRelay Durable Object (no inbound port, no DNS); Jon's phone opens another from
// /dashboard/call. Mic audio (16-bit mono PCM, 24 kHz) goes phone -> GPU1, Grok's audio and events go
// GPU1 -> phone. Hibernation keeps the idle GPU1 link free: its "ping" is answered without waking.
import { readSession, timingSafeEqualString } from './auth.js';

export const STARTS_PER_HOUR = 10;
export const MAX_CALL_MS = 30 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const LIVE_MS = 75 * 1000; // GPU1 pings every 30 s: a link silent this long died without a close

export async function handleCall(request, env) {
  const url = new URL(request.url);
  const role = url.pathname.slice('/dashboard/api/call/'.length);
  if (role === 'gpu1') {
    const secret = env.CALL_RELAY_SECRET || '';
    const auth = request.headers.get('Authorization') || '';
    if (secret.length < 32 || !timingSafeEqualString(auth, `Bearer ${secret}`)) return new Response('Unauthorized', { status: 401 });
  } else if (role === 'phone') {
    if (!(await readSession(request, env))) return new Response('Sign in', { status: 401 });
    if (request.headers.get('Origin') !== url.origin) return new Response('Forbidden', { status: 403 });
  } else {
    return new Response('Not found', { status: 404 });
  }
  if ((request.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
  if (!env.CALL_RELAY) return new Response('Calls are not set up', { status: 503 });
  const relay = env.CALL_RELAY.get(env.CALL_RELAY.idFromName('ana'));
  return relay.fetch(new Request(url, { headers: { Upgrade: 'websocket', 'X-Call-Role': role } }));
}

const parse = (msg) => {
  try { return typeof msg === 'string' ? JSON.parse(msg) || {} : {}; } catch { return {}; }
};
const send = (ws, msg) => { try { ws.send(msg); } catch { /* gone */ } };
const close = (ws, code, reason) => { try { ws.close(code, reason); } catch { /* gone */ } };

export class CallRelay {
  constructor(ctx) {
    this.ctx = ctx;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  open(tag) {
    return this.ctx.getWebSockets(tag).filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  async fetch(request) {
    const [client, server] = Object.values(new WebSocketPair());
    if (request.headers.get('X-Call-Role') === 'gpu1') {
      this.endCall(4502, 'GPU1 reconnected. Call again.');
      for (const old of this.open('gpu1')) close(old, 4000, 'Replaced by a newer GPU1 connection.');
      this.ctx.acceptWebSocket(server, ['gpu1']);
      server.serializeAttachment({ at: Date.now() });
    } else {
      const refused = await this.refusal(Date.now());
      if (refused) {
        server.accept();
        close(server, ...refused);
      } else {
        this.endCall(4001, 'Replaced by a new call.');
        // Each call has its own id: GPU1 echoes it in call.started, so a slower, older start can't take this call.
        const id = crypto.randomUUID();
        this.ctx.acceptWebSocket(server, ['phone']);
        server.serializeAttachment({ id, ready: false });
        this.toGpu1(JSON.stringify({ type: 'call.start', id }));
        await this.ctx.storage.setAlarm(Date.now() + MAX_CALL_MS);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async refusal(now) {
    if (!this.gpu1Live(now)) return [4503, 'GPU1 is offline, so Ana cannot take calls right now.'];
    const starts = ((await this.ctx.storage.get('starts')) || []).filter((t) => now - t < HOUR);
    if (starts.length >= STARTS_PER_HOUR) return [4429, `That is ${STARTS_PER_HOUR} calls this hour. Try again later.`];
    await this.ctx.storage.put('starts', [...starts, now]);
    return null;
  }

  gpu1Live(now) {
    return this.open('gpu1').some((ws) => now - Math.max(ws.deserializeAttachment()?.at || 0,
      this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() || 0) < LIVE_MS);
  }

  toGpu1(msg) {
    for (const ws of this.open('gpu1')) send(ws, msg);
  }

  endCall(code, reason) {
    const phones = this.open('phone');
    for (const ws of phones) close(ws, code, reason);
    if (phones.length) this.toGpu1(JSON.stringify({ type: 'call.end' }));
  }

  webSocketMessage(ws, msg) {
    if (this.ctx.getTags(ws).includes('gpu1')) return this.fromGpu1(msg);
    if (ws.readyState !== WebSocket.OPEN) return; // a phone a newer call already replaced
    if (typeof msg !== 'string') { // mic audio, once GPU1 has picked up this call
      if (ws.deserializeAttachment()?.ready) this.toGpu1(msg);
      return;
    }
    if (parse(msg).type === 'session.close') this.endCall(1000, 'Call ended.'); // Hang up
  }

  fromGpu1(msg) {
    const [phone] = this.open('phone');
    if (!phone) return;
    const { type, id } = parse(msg);
    const at = phone.deserializeAttachment() || {};
    // GPU1 handles calls in order, so everything after this call's own call.started belongs to it.
    if (!at.ready && type === 'call.started' && id === at.id) phone.serializeAttachment({ ...at, ready: true });
    else if (!at.ready) return; // still in flight from a call before
    send(phone, msg);
    if (type === 'session.closed') close(phone, 1000, 'Call ended.');
  }

  webSocketClose(ws) {
    if (this.ctx.getTags(ws).includes('gpu1')) {
      if (!this.open('gpu1').some((other) => other !== ws)) {
        for (const phone of this.open('phone')) close(phone, 4502, 'GPU1 disconnected. Call again in a minute.');
      }
    } else if (!this.open('phone').some((other) => other !== ws)) {
      this.toGpu1(JSON.stringify({ type: 'call.end' }));
    }
  }

  webSocketError(ws) {
    this.webSocketClose(ws);
  }

  alarm() {
    this.endCall(4408, 'Calls end after 30 minutes. Call again to keep going.');
  }
}
