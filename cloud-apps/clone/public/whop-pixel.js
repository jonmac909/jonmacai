// Port of viralview.io/lib/whop-pixel.ts. The API key belongs only on the Worker.
(function () {
  'use strict';
  if (window.CloneMode && CloneMode.environment === 'sandbox') return;
  var keys = new Set(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'utm_id', 'vv_link',
    'utm_meta_ad_id', 'utm_meta_adset_id', 'utm_meta_campaign_id', 'utm_placement', 'utm_adset', 'utm_whop',
    'wacid', 'wasid', 'waid', 'fbclid', 'gclid', 'twclid', 'ttclid', 'gbraid', 'wbraid', 'msclkid']);
  var attr = {};
  try { attr = JSON.parse(sessionStorage.getItem('clone_whop_attr') || '{}') || {}; } catch (e) {}
  Object.keys(attr).forEach(function (k) { if (!keys.has(k) || typeof attr[k] !== 'string' || attr[k].length > 500) delete attr[k]; });
  new URLSearchParams(location.search).forEach(function (v, k) { if (keys.has(k.toLowerCase()) && v.length <= 500) attr[k.toLowerCase()] = v; });
  try { sessionStorage.setItem('clone_whop_attr', JSON.stringify(attr)); } catch (e) {}

  // Exact production queue/snippet, with page tracking below after attribution capture.
  !function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");
  whop.setScope('biz_7mMLeRhCNlr8Nl');
  whop.track('page');

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
      if (u.origin !== 'https://commas.com' || !/^\/checkout\/[A-Za-z0-9]+$/.test(u.pathname)) return value;
      var data = metadata();
      Object.keys(data).forEach(function (k) { if (data[k]) u.searchParams.set(k, data[k]); });
      return u.toString();
    } catch (e) { return value; }
  }
  function track(name, props) { if (window.whop) whop.track(name, props); }
  function lead(email) {
    var id = 'clone_lead_' + crypto.randomUUID();
    track('lead', { event_id: id, email: email });
    track('complete_registration', { event_id: id + '_registration', email: email });
    return { eventId: id, registrationEventId: id + '_registration', anonymousId: anonymousId(), pageUrl: pageUrl() };
  }
  window.CloneWhop = { metadata: metadata, decorate: decorate, lead: lead };
  function decorateLinks() {
    document.querySelectorAll('a[href*="commas.com/checkout"]').forEach(function (a) { a.href = decorate(a.href); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateLinks);
  else decorateLinks();
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a');
    if (!a || a.getAttribute('aria-disabled') === 'true') return;
    var offer = a.dataset.upsell;
    var price = { software: 97, trial: 0, audit: 497, vault: 297, vault_plan: 99 };
    if (offer || /^https:\/\/commas\.com\/checkout\//.test(a.href)) {
      a.href = decorate(a.href);
      track('add_to_cart', { event_id: 'clone_checkout_' + crypto.randomUUID(), value: offer ? price[offer] : 47, currency: 'USD' });
    }
  }, true);
})();
