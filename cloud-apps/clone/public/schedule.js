// One daily 19:00 America/New_York session, independent of the viewer's zone.
// Launch: the first live session is Thu Oct 22 2026 at 7 PM ET. Anyone before
// 5 PM ET that day gets it; afterwards the daily rule applies.
(function (root) {
  'use strict';
  var FIRST_SESSION = Date.UTC(2026, 9, 22, 23, 0, 0); // Thu Oct 22 2026, 7 PM EDT
  var LAUNCH_CUTOFF = FIRST_SESSION - 2 * 3600000;      // 5 PM EDT
  var LAUNCH_FROM = Date.UTC(2026, 9, 13);               // pre-launch window start
  function sevenET(y, m, d) {
    var t = Date.UTC(y, m, d, 23);
    for (var i = 0; i < 3; i++) {
      var h = Number(new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23'
      }).format(new Date(t)));
      if (h === 19) break;
      t += (19 - h) * 3600000;
    }
    return new Date(t);
  }
  function nextSession(now) {
    now = now || new Date();
    if (now.getTime() >= LAUNCH_FROM && now.getTime() < LAUNCH_CUTOFF) return new Date(FIRST_SESSION);
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric'
    }).formatToParts(now);
    function part(name) { return Number(parts.find(function (p) { return p.type === name; }).value); }
    for (var i = 0; i < 2; i++) {
      var day = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + i));
      var target = sevenET(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
      if (target > now) return target;
    }
  }
  function calendarDates(target) {
    // Local dates plus ctz keep a DAILY recurrence at 7 PM across DST changes.
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(target);
    function part(name) { return parts.find(function (p) { return p.type === name; }).value; }
    var day = part('year') + part('month') + part('day');
    return day + 'T190000/' + day + 'T210000';
  }
  root.CloneSchedule = { sevenET: sevenET, nextSession: nextSession, calendarDates: calendarDates,
    firstSession: new Date(FIRST_SESSION), launchCutoff: new Date(LAUNCH_CUTOFF) };
})(globalThis);
