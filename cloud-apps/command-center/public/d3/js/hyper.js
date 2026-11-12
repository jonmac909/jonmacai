// Dashboard 3 Hyper page: the HyperFrames app (the video editor on GPU1) in a frame. The app lives at
// hyper.jonmac.ai behind its own gate (cloud-apps/hyper); this page asks the dashboard for a 60-second ticket
// (GET /dashboard/api/hyper/ticket, session cookie) and opens the app with it. Drawn once per visit, so the 60 s
// data reload never restarts the app (app.js).
import { headerOnly } from './goals.js';

const HTTPS = /^https:\/\/[a-z0-9.-]+(\/|$)/i;

export function renderHyper(d2resp) {
  const open = '<a class="btn sm sp" id="hyTab" href="#hyper" target="_blank" rel="noopener" hidden>Open in its own tab</a>';
  return `${headerOnly(d2resp, 'Hyper', 'HyperFrames, the video editor on GPU1', open)}
<section class="card hy">
<p class="mut" id="hyNote" role="status">Opening the app</p>
<iframe id="hyFrame" title="HyperFrames" allow="clipboard-read; clipboard-write; microphone; fullscreen" hidden></iframe>
</section>`;
}

// Asks for a ticket and points the frame at the app. getJson is app.js's reader ({ signedOut } or { body }).
export async function openHyper(main, getJson) {
  const frame = main.querySelector('#hyFrame');
  const note = main.querySelector('#hyNote');
  if (!frame || !note) return;
  try {
    const t = await getJson('/dashboard/api/hyper/ticket');
    if (t.signedOut) { note.innerHTML = 'You are signed out. <a href="/dash/">Sign in</a>'; return; }
    const { url, origin } = t.body || {};
    if (!HTTPS.test(url || '') || !HTTPS.test(origin || '')) throw new Error('no address came back');
    if (!frame.isConnected) return; // Jon left the page while the ticket was on its way
    frame.src = url;
    frame.hidden = false;
    note.hidden = true;
    const tab = main.querySelector('#hyTab');
    if (tab) { tab.href = `${origin}/`; tab.hidden = false; } // works once the frame has signed in
  } catch (err) {
    note.textContent = `Could not open the app (${err.message}).`;
  }
}
