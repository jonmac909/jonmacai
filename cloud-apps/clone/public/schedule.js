// One live session only (Jon, Oct 20): Thu Oct 29 2026, 7 PM ET, 2 hours.
// Sales close 15 minutes before it starts. src/reminder-plan.js uses the same times.
(function (root) {
  'use strict';
  var SESSION = Date.UTC(2026, 9, 29, 23, 0, 0);  // Thu Oct 29 2026, 7 PM EDT
  var SALES_CLOSE = SESSION - 15 * 60000;          // 6:45 PM EDT
  var SESSION_END = SESSION + 2 * 3600000;         // 9 PM EDT
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
