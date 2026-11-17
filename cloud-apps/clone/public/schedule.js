// One live session only: Thu Nov 12 2026, 4 PM PT / 7 PM ET, 2 hours (Jon, Oct 30).
// Sales close at 5:30 PM PT / 8:30 PM ET, 90 minutes into the session, after the pitch (Jon, Oct 21).
// src/reminder-plan.js uses the same times.
(function (root) {
  'use strict';
  // THE ONE SWITCH: next live session start in UTC ms (e.g. Date.UTC(2026, 11, 3, 0, 0, 0)), or null while there is no date.
  // null = emails only, nothing sells, no date shown. Keep equal to NEXT_SESSION in src/reminder-plan.js.
  var NEXT_SESSION = null;
  var SESSION = NEXT_SESSION === null ? Date.UTC(2026, 10, 13, 0, 0, 0) : NEXT_SESSION; // fallback only for old buyers' math
  var SALES_CLOSE = SESSION + 90 * 60000;
  var SESSION_END = SESSION + 2 * 3600000;          // 9 PM EST
  function nextSession() { return new Date(SESSION); }
  function isClosed(now) { return NEXT_SESSION === null || (now || new Date()).getTime() >= SALES_CLOSE; } // i.e. not selling
  function hasDate() { return NEXT_SESSION !== null; }
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
  root.CloneSchedule = { nextSession: nextSession, hasDate: hasDate, isClosed: isClosed, phase: phase, calendarDates: calendarDates,
    session: new Date(SESSION), salesClose: new Date(SALES_CLOSE), sessionEnd: new Date(SESSION_END) };
})(globalThis);
