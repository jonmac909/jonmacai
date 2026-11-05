// Post-purchase pages (welcome, survey, software, audit, vault) after sales close.
// Before the cutoff this does nothing but remember that the browser reached a buyer page.
// After the cutoff a browser without a verified purchase sees "Registration Closed"
// instead of the page. Billing is blocked server-side (upsell returns 410); this is the message.
// Needs /clone/schedule.js first. CloneGate.verify() is shared with upsells.js.
(function () {
  'use strict';
  var sandbox = !!(window.CloneMode && CloneMode.environment === 'sandbox');
  var prefix = sandbox ? 'jm_sandbox_clone_' : 'jm_clone_';
  var seen = prefix + 'buyer_seen';
  var closed = !!(window.CloneSchedule && CloneSchedule.isClosed());
  var buyer;

  function verify() {
    if (buyer) return buyer;
    buyer = (async function () {
      var ref;
      try { ref = sessionStorage.getItem(prefix + 'transaction'); } catch (e) {}
      for (var i = 0; i < 12; i++) {
        var response = await fetch('/clone/api/buyer-session' + (sandbox ? '?sandbox=1' : ''), { method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactionId: ref || undefined }), signal: AbortSignal.timeout(20000) });
        var result = await response.json();
        if (!result.pending) return !!result.ok;
        await new Promise(function (resolve) { setTimeout(resolve, 1000); });
      }
      return false;
    })().catch(function () { return false; });
    return buyer;
  }

  function showClosed() {
    var panel = document.createElement('div');
    panel.id = 'jm-closed'; panel.setAttribute('role', 'alert');
    panel.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
      'padding:24px;background:#0E0D11;color:#fff;text-align:center;font:18px/1.5 Georgia,serif';
    panel.innerHTML = '<div style="max-width:520px"><h1 style="margin:0 0 14px;font:700 32px/1.2 Montserrat,Arial,sans-serif">Registration Closed</h1>' +
      '<p style="margin:0">Registration for this live session has closed.</p>' +
      '<p style="margin:14px 0 0;opacity:.75;font-size:16px">Already registered? Check your confirmation email for your access details.</p></div>';
    document.body.style.display = 'none';
    document.documentElement.appendChild(panel);
    document.documentElement.classList.add('sales-closed');
  }

  window.CloneGate = { closed: closed, verify: verify };
  if (!closed) {
    try { localStorage.setItem(seen, '1'); } catch (e) {}
    return;
  }
  var known = false;
  try { known = !!localStorage.getItem(seen); } catch (e) {}
  if (known) return;
  var hide = document.createElement('style');
  hide.textContent = 'html.jm-gate-pending body{visibility:hidden}';
  document.head.appendChild(hide); document.documentElement.classList.add('jm-gate-pending');
  verify().then(function (ok) {
    document.documentElement.classList.remove('jm-gate-pending');
    if (ok) { try { localStorage.setItem(seen, '1'); } catch (e) {} return; }
    if (document.body) showClosed(); else document.addEventListener('DOMContentLoaded', showClosed);
  });
})();
