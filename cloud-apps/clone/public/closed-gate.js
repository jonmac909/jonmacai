// Post-purchase pages (welcome, survey, software, audit, vault): every visitor sees the page.
// (Jon, Nov 16: no closed wall.) Billing is still blocked server-side (upsell returns 410).
// CloneGate.verify() is shared with upsells.js.
(function () {
  'use strict';
  var sandbox = !!(window.CloneMode && CloneMode.environment === 'sandbox');
  var prefix = sandbox ? 'jm_sandbox_clone_' : 'jm_clone_';
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

  window.CloneGate = { closed: false, verify: verify };
})();
