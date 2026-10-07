// One daily 19:00 America/New_York session, independent of the viewer's zone.
(function (root) {
  'use strict';
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
  root.CloneSchedule = { sevenET: sevenET, nextSession: nextSession, calendarDates: calendarDates };
})(globalThis);
