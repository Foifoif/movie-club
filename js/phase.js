// ─── CLUB NIGHT PHASE ────────────────────────────────────────────────────────
// Sole authority on what phase a club night is in. Pure, dependency-free, and
// loadable both as a plain <script> (no JSX, no transpilation) and via
// `require()` under the Node test runner — the two live countdowns (home
// lockup, next-club page) each derived "is it go time" locally and drifted;
// this is the one place that decision gets made.
(function (global, factory) {
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else {
    global.ClubNightPhase = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PHASE = { COUNTDOWN: 'countdown', JOINABLE: 'joinable' };

  // At or below this many milliseconds out, the night is joinable rather than
  // merely counting down. Includes all time after the start has passed.
  var JOINABLE_THRESHOLD_MS = 3 * 60 * 60 * 1000;

  var MS_PER_MINUTE = 60 * 1000;
  var MS_PER_HOUR = 60 * MS_PER_MINUTE;
  var MS_PER_DAY = 24 * MS_PER_HOUR;

  // Returns { phase, days, hours, minutes } for the given club night, or null
  // when there is no meeting datetime to judge a phase against. `now` defaults
  // to the current time; pass it explicitly to test or to drive a dev clock.
  function getPhase(meetingDatetime, now) {
    if (meetingDatetime === null || meetingDatetime === undefined) return null;

    var meetingTime = meetingDatetime instanceof Date
      ? meetingDatetime.getTime()
      : new Date(meetingDatetime).getTime();
    if (Number.isNaN(meetingTime)) return null;

    var currentTime = now instanceof Date ? now.getTime()
      : typeof now === 'number' ? now
      : Date.now();

    var remainingMs = meetingTime - currentTime;
    var phase = remainingMs > JOINABLE_THRESHOLD_MS ? PHASE.COUNTDOWN : PHASE.JOINABLE;

    var clampedMs = Math.max(0, remainingMs);
    var days = Math.floor(clampedMs / MS_PER_DAY);
    var hours = Math.floor((clampedMs % MS_PER_DAY) / MS_PER_HOUR);
    var minutes = Math.floor((clampedMs % MS_PER_HOUR) / MS_PER_MINUTE);

    return { phase: phase, days: days, hours: hours, minutes: minutes };
  }

  return { PHASE: PHASE, JOINABLE_THRESHOLD_MS: JOINABLE_THRESHOLD_MS, getPhase: getPhase };
});
