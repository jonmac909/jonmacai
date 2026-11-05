// One live session only: Thu Nov 12 2026, 4 PM PT / 7 PM ET, 2 hours (Jon, Oct 30).
// Sales close at 5:30 PM PT / 8:30 PM ET, 90 minutes into the session, after the pitch (Jon, Oct 21).
// src/reminder-plan.js uses the same times.
(function (root) {
  'use strict';
  var SESSION = Date.UTC(2026, 10, 13, 0, 0, 0);    // Thu Nov 12 2026, 4 PM PST / 7 PM EST
  var SALES_CLOSE = Date.UTC(2026, 10, 13, 1, 30, 0); // Thu Nov 12 5:30 PM PST / 8:30 PM EST
  var SESSION_END = SESSION + 2 * 3600000;          // 9 PM EST
  function nextSession() { return new Date(SESSION); }
  function isClosed(now) { return (now || new Date()).getTime() >= SALES_CLOSE; }
  function phase(now) {
    var t = (now || new Date()).getTime();
    return t < SESSION ? 'before' : t < SESSION_END ? 'live' : 'ended';
  }
  function calendarDates(target) {
    // Local Eastern dates plus ctz=America/New_York: a single 7-9 PM event.
    var parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(target);
    function part(name) { return parts.find(function (p) { return p.type === name; }).value; }
    var day = part('year') + part('month') + part('day');
    return day + 'T190000/' + day + 'T210000';
  }
  root.CloneSchedule = { nextSession: nextSession, isClosed: isClosed, phase: phase, calendarDates: calendarDates,
    session: new Date(SESSION), salesClose: new Date(SALES_CLOSE), sessionEnd: new Date(SESSION_END) };
})(globalThis);
