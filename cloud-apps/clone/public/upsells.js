(function () {
  'use strict';
  var sandbox = !!(window.CloneMode && CloneMode.environment === 'sandbox');
  var suffix = sandbox ? '?sandbox=1' : '';
  var storagePrefix = sandbox ? 'jm_sandbox_clone_' : 'jm_clone_';
  function validHosted(url) {
    return sandbox ? Object.values(CloneMode.hosted).includes(url) && /^https:\/\/sandbox\.commas\.net\//.test(url || '') :
      /^https:\/\/commas\.com\/checkout\/[A-Za-z0-9]+$/.test(url || '');
  }
  var buttons = Array.from(document.querySelectorAll('[data-upsell]'));
  var busy = false, panel, buyerReady;
  var style = document.createElement('style');
  style.textContent = '[data-upsell][aria-disabled="true"]{opacity:.7;cursor:wait;pointer-events:none}' +
    '.upsell-spinner{display:inline-block;width:18px;height:18px;margin-right:10px;border:2px solid #fff;border-right-color:transparent;border-radius:50%;animation:upsell-spin .8s linear infinite}' +
    '@keyframes upsell-spin{to{transform:rotate(360deg)}}' +
    '.upsell-result{margin:16px 0;text-align:center}.upsell-result p{margin-bottom:14px}' +
    '.upsell-result button{font:inherit;cursor:pointer;border:0}' +
    '@media(prefers-reduced-motion:reduce){.upsell-spinner{animation:none}}';
  document.head.appendChild(style);

  async function post(path, body) {
    var response = await fetch('/clone/api/' + path + suffix, { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    return response.json();
  }
  async function verifyBuyer() {
    var ref;
    try { ref = sessionStorage.getItem(storagePrefix + 'transaction'); } catch (e) {}
    for (var i = 0; i < 12; i++) {
      var result = await post('buyer-session', { transactionId: ref || undefined });
      if (!result.pending) return result.ok;
      await new Promise(function (resolve) { setTimeout(resolve, 1000); });
    }
    return false;
  }
  buyerReady = verifyBuyer().catch(function () { return false; });

  function disable(value) {
    busy = value;
    buttons.forEach(function (b) { b.setAttribute('aria-disabled', String(value)); });
  }
  function message(button, text) {
    if (panel) panel.remove();
    panel = document.createElement('div'); panel.className = 'upsell-result';
    panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite');
    var p = document.createElement('p'); p.textContent = text; panel.appendChild(p);
    button.after(panel);
    return panel;
  }
  async function accept(button) {
    if (busy) return;
    disable(true);
    if (panel) panel.remove();
    var old = button.innerHTML;
    button.innerHTML = '<span class="upsell-spinner" aria-hidden="true"></span>Processing your order…';
    button.setAttribute('aria-busy', 'true');
    var result;
    var group = ['software', 'trial'].includes(button.dataset.upsell) ? 'software' :
      ['vault', 'vault_plan'].includes(button.dataset.upsell) ? 'vault' : 'audit';
    var pendingKey = storagePrefix + 'pending_' + group, hadPending = false;
    try { hadPending = !!sessionStorage.getItem(pendingKey); } catch (e) {}
    try {
      await buyerReady;
      // Persist BEFORE dispatch so a refresh during the charge also stays safe.
      try { sessionStorage.setItem(pendingKey, '1'); } catch (e) {}
      result = await post('upsell', { offer: button.dataset.upsell });
    } catch (e) {
      // A network failure can happen AFTER billing. A repeat checks the durable
      // claim and cannot submit a second charge; never expose hosted checkout here.
      result = { pending: true, message: 'We could not confirm your payment yet. Check its status before placing another order.' };
    }
    if (hadPending && result.fallback && ['buyer_unverified', 'unavailable'].includes(result.reason)) {
      result = { pending: true, message: 'Your earlier payment still needs confirmation. Contact support before placing another order.' };
    }
    if (result.ok || result.fallback) {
      try { sessionStorage.removeItem(pendingKey); } catch (e) {}
    }
    if (result.ok && /^\/clone\/(audit|vault|welcome)\.html(?:\?sandbox=1)?$/.test(result.next || '')) {
      if (sandbox !== result.next.endsWith('?sandbox=1')) throw new Error('Wrong checkout environment');
      location.href = result.next; return;
    }
    if (result.fallback && ['rebill_unavailable', 'trial_hosted', 'buyer_unverified', 'no_saved_card', 'previous_fallback'].includes(result.reason) &&
        validHosted(result.checkoutUrl)) {
      location.href = result.checkoutUrl; return;
    }
    button.innerHTML = old; button.removeAttribute('aria-busy');
    var slot = message(button, result.message || 'This offer needs secure checkout to finish. Continue with Commas below.');
    if (result.fallback && validHosted(result.checkoutUrl)) {
      var link = document.createElement('a'); link.className = 'yes'; link.href = result.checkoutUrl;
      link.textContent = 'Continue to Secure Checkout →'; slot.appendChild(link);
      disable(false);
    } else {
      var check = document.createElement('button'); check.className = 'yes';
      check.textContent = 'Check Payment Status';
      check.addEventListener('click', function () { disable(false); accept(button); }); slot.appendChild(check);
      // Leave every offer choice disabled until the original request resolves.
    }
  }
  buttons.forEach(function (button) {
    button.setAttribute('role', 'button');
    button.addEventListener('click', function (event) { event.preventDefault(); accept(button); });
    button.addEventListener('keydown', function (event) {
      if (event.key === ' ') { event.preventDefault(); accept(button); }
    });
  });
})();
