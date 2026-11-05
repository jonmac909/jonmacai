// Meta pixel for every Clone page. Loads only when the Worker injected a pixel ID
// (window.CLONE_META, production with META_PIXEL_ID set); otherwise does nothing.
// Purchases fire on the page after the sale, with the same eventID the server
// sends to the Conversions API, so Meta counts each sale once.
(function () {
  'use strict';
  var C = window.CLONE_META;
  if (!C || !/^[0-9]{5,20}$/.test(C.pixelId || '') || window.fbq) return;
  !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ?
    n.callMethod.apply(n, arguments) : n.queue.push(arguments) }; if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0;
    t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s) }(window, document, 'script',
    'https://connect.facebook.net/en_US/fbevents.js');
  fbq('init', C.pixelId);
  fbq('track', 'PageView');
  var KEY = 'jm_meta_pending_purchases';
  function pending() { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch (e) { return []; } }
  var fired = {};
  try { fired = JSON.parse(localStorage.getItem('jm_meta_fired') || '{}'); } catch (e) {}
  pending().forEach(function (p) {
    if (!p || !/^clone_purchase_[A-Za-z0-9_-]{3,200}$/.test(p.eventId || '') || !(p.value > 0) || fired[p.eventId]) return;
    fbq('track', 'Purchase', { value: p.value, currency: 'USD' }, { eventID: p.eventId });
    fired[p.eventId] = 1;
  });
  try { sessionStorage.removeItem(KEY); localStorage.setItem('jm_meta_fired', JSON.stringify(fired)); } catch (e) {}
})();
// Queue a purchase for the next page (works with or without the pixel loaded).
window.CloneMetaQueue = function (eventId, value) {
  try {
    var list = JSON.parse(sessionStorage.getItem('jm_meta_pending_purchases') || '[]');
    list.push({ eventId: eventId, value: value });
    sessionStorage.setItem('jm_meta_pending_purchases', JSON.stringify(list.slice(-5)));
  } catch (e) {}
};
