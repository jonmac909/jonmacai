(function () {
  'use strict';
  var suffix = window.CloneMode && CloneMode.environment === 'sandbox' ? '?sandbox=1' : '';
  fetch('/clone/api/readiness' + suffix).then(function (r) { if (!r.ok) throw new Error(); return r.json(); })
    .then(function (config) {
      document.querySelectorAll('[data-faq-video]').forEach(function (slot) {
        var id = config.faqVideos && config.faqVideos[slot.dataset.faqVideo];
        if (!/^[A-Za-z0-9_-]{11}$/.test(id || '')) return;
        var frame = document.createElement('iframe');
        frame.src = 'https://www.youtube-nocookie.com/embed/' + id + '?rel=0';
        frame.title = slot.dataset.videoTitle; frame.loading = 'lazy';
        frame.allow = 'encrypted-media; picture-in-picture; fullscreen'; frame.allowFullscreen = true;
        frame.referrerPolicy = 'strict-origin-when-cross-origin';
        slot.appendChild(frame); slot.hidden = false;
      });
      if (!config.metricsEnabled || !document.getElementById('leadf') || !window.CloneSchedule) return;
      var date = CloneSchedule.calendarDates(CloneSchedule.nextSession()).slice(0, 8), key = 'clone_visit_' + date;
      var id;
      try { id = sessionStorage.getItem(key); } catch (_) {}
      if (!id) id = crypto.randomUUID();
      // Reuse the ID on reload; the server deduplicates even if the response was lost.
      try { sessionStorage.setItem(key, id); } catch (_) {}
      return fetch('/clone/api/visit' + suffix, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: id }), keepalive: true });
    }).catch(function () { /* Answers and checkout remain usable without configuration/metrics. */ });
})();
