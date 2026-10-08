// Port of viralview.io/lib/whop-pixel.ts. The API key belongs only on the Worker.
(function () {
  'use strict';
  // Preview/local hosts must not pollute the production ad account.
  var sandbox = (window.CloneMode && CloneMode.environment === 'sandbox') || new URLSearchParams(location.search).get('sandbox') === '1';
  if (!sandbox && location.hostname !== 'jonmac.ai') return;
  var attrKey = sandbox ? 'clone_sandbox_whop_attr' : 'clone_whop_attr';
  var keys = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'vv_link',
    'utm_meta_ad_id', 'utm_meta_adset_id', 'utm_meta_campaign_id', 'utm_placement', 'utm_adset', 'utm_whop',
    'wacid', 'wasid', 'waid', 'fbclid', 'gclid', 'twclid', 'ttclid', 'gbraid', 'wbraid', 'msclkid']);
  var attr = {};
  try { attr = JSON.parse(sessionStorage.getItem(attrKey) || '{}') || {}; } catch (e) {}
  Object.keys(attr).forEach(function (k) { if (!keys.has(k) || typeof attr[k] !== 'string' || attr[k].length > 500) delete attr[k]; });
  new URLSearchParams(location.search).forEach(function (v, k) { if (keys.has(k.toLowerCase()) && v.length <= 500) attr[k.toLowerCase()] = v; });
  try { sessionStorage.setItem(attrKey, JSON.stringify(attr)); } catch (e) {}

  // Exact production queue/snippet, with page tracking below after attribution capture.
  if (!sandbox) {
    !function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");
    whop.setScope('biz_7mMLeRhCNlr8Nl');
  }
  var journey;
  if (sandbox) {
    try {
      journey = sessionStorage.getItem('jm_sandbox_clone_transaction') || sessionStorage.getItem('clone_sandbox_journey');
      if (!journey) { journey = crypto.randomUUID(); sessionStorage.setItem('clone_sandbox_journey', journey); }
    } catch (e) { journey = crypto.randomUUID(); }
  }
  track('page', undefined, sandbox ? journey + ':page:' + location.pathname : undefined);

  function anonymousId() {
    var raw = document.cookie.split(';').map(function (s) { return s.trim(); }).find(function (s) { return s.startsWith('_wuid='); });
    try { var value = raw && decodeURIComponent(raw.slice(6)); return /^wuid_[a-z0-9_-]{1,128}$/i.test(value || '') ? value : null; }
    catch (e) { return null; }
  }
  function pageUrl() {
    var u = new URL(location.pathname, location.origin);
    Object.keys(attr).forEach(function (k) { u.searchParams.set(k, attr[k]); });
    return u.toString();
  }
  function metadata() {
    return Object.assign({}, attr, { whop_anonymous_id: anonymousId() || '', whop_page_url: pageUrl() });
  }
  function decorate(value) {
    try {
      var u = new URL(value);
      if (u.origin !== (sandbox ? 'https://sandbox.commas.net' : 'https://commas.com') || !/^\/checkout\/[A-Za-z0-9]+$/.test(u.pathname)) return value;
      var data = metadata();
      Object.keys(data).forEach(function (k) { if (data[k]) u.searchParams.set(k, data[k]); });
      return u.toString();
    } catch (e) { return value; }
  }
  function track(name, props, key) {
    if (sandbox) {
      key = key || journey + ':' + (props && props.event_id || name + ':' + crypto.randomUUID());
      var record = { mode: 'sandbox-log-only', dedup_key: key,
        payload: { event_name: name, url: pageUrl(), ...(props ? { properties: props } : {}) } };
      // No SDK, scope or network request exists in sandbox. Persist the exact
      // browser payload before logging so reloads reuse the same dedup key.
      try {
        var storageKey = 'clone_sandbox_whop_event:' + key;
        if (sessionStorage.getItem(storageKey)) return;
        sessionStorage.setItem(storageKey, JSON.stringify(record));
      } catch (e) {}
      console.info(JSON.stringify(record));
      return;
    }
    if (window.whop) whop.track(name, props);
  }
  function lead(email) {
    var id = 'clone_lead_' + crypto.randomUUID();
    track('lead', { event_id: id, email: email });
    track('complete_registration', { event_id: id + '_registration', email: email });
    return { eventId: id, registrationEventId: id + '_registration', anonymousId: anonymousId(), pageUrl: pageUrl() };
  }
  window.CloneWhop = { metadata: metadata, decorate: decorate, lead: lead };
  function decorateLinks() {
    document.querySelectorAll('a[href*="/checkout/"]').forEach(function (a) { a.href = decorate(a.href); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateLinks);
  else decorateLinks();
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a || a.getAttribute('aria-disabled') === 'true') return;
    var offer = a.dataset.upsell;
    var price = { software: 97, trial: 0, audit: 497, vault: 297, vault_plan: 99 };
    if (offer || /^https:\/\/(?:commas\.com|sandbox\.commas\.net)\/checkout\//.test(a.href)) {
      a.href = decorate(a.href);
      track('add_to_cart', { event_id: 'clone_checkout_' + crypto.randomUUID(), value: offer ? price[offer] : 47, currency: 'USD' });
    }
  }, true);
})();
