'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getPhase, PHASE, JOINABLE_THRESHOLD_MS } = require('../js/phase.js');

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

test('comfortably outside the window is the countdown phase', () => {
  const meeting = NOW + 5 * 24 * 60 * 60 * 1000; // 5 days out
  assert.equal(getPhase(meeting, NOW).phase, PHASE.COUNTDOWN);
});

test('exactly at the three-hour boundary is the joinable phase', () => {
  const meeting = NOW + JOINABLE_THRESHOLD_MS;
  assert.equal(getPhase(meeting, NOW).phase, PHASE.JOINABLE);
});

test('one millisecond beyond the three-hour boundary is still the countdown phase', () => {
  const meeting = NOW + JOINABLE_THRESHOLD_MS + 1;
  assert.equal(getPhase(meeting, NOW).phase, PHASE.COUNTDOWN);
});

test('inside the window is the joinable phase', () => {
  const meeting = NOW + 60 * 60 * 1000; // 1 hour out
  assert.equal(getPhase(meeting, NOW).phase, PHASE.JOINABLE);
});

test('exactly at the start time is the joinable phase', () => {
  assert.equal(getPhase(NOW, NOW).phase, PHASE.JOINABLE);
});

test('after the start time has passed is still the joinable phase, clamped at zero', () => {
  const meeting = NOW - 60 * 60 * 1000; // started an hour ago
  const result = getPhase(meeting, NOW);
  assert.equal(result.phase, PHASE.JOINABLE);
  assert.equal(result.days, 0);
  assert.equal(result.hours, 0);
  assert.equal(result.minutes, 0);
});

test('a null meeting datetime yields no phase decision', () => {
  assert.equal(getPhase(null, NOW), null);
});

test('a missing meeting datetime yields no phase decision', () => {
  assert.equal(getPhase(undefined, NOW), null);
});

test('decomposes a two-digit day count alongside hours and minutes', () => {
  const meeting = NOW + 12 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000 + 30 * 60 * 1000;
  const result = getPhase(meeting, NOW);
  assert.equal(result.days, 12);
  assert.equal(result.hours, 5);
  assert.equal(result.minutes, 30);
});

test('rolls over from 23 hours 59 minutes into the next day', () => {
  const justUnder = getPhase(NOW + (24 * 60 * 60 * 1000 - 60 * 1000), NOW);
  assert.equal(justUnder.days, 0);
  assert.equal(justUnder.hours, 23);
  assert.equal(justUnder.minutes, 59);

  const exactlyOneDay = getPhase(NOW + 24 * 60 * 60 * 1000, NOW);
  assert.equal(exactlyOneDay.days, 1);
  assert.equal(exactlyOneDay.hours, 0);
  assert.equal(exactlyOneDay.minutes, 0);
});

test('rolls over from 59 minutes into the next hour', () => {
  const justUnder = getPhase(NOW + (60 * 60 * 1000 - 60 * 1000), NOW);
  assert.equal(justUnder.hours, 0);
  assert.equal(justUnder.minutes, 59);

  const exactlyOneHour = getPhase(NOW + 60 * 60 * 1000, NOW);
  assert.equal(exactlyOneHour.hours, 1);
  assert.equal(exactlyOneHour.minutes, 0);
});

test('seconds within a minute are truncated, not rounded up', () => {
  const result = getPhase(NOW + 59 * 1000, NOW); // 59 seconds out
  assert.equal(result.minutes, 0);
});
