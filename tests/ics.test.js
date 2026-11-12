// iCal parsing (src/main/integrations.js): time zones, exceptions, moved and cancelled occurrences.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseIcs } = require('../src/main/integrations');

const cal = (...events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');
const range = (y, m, d, days) => { const from = new Date(y, m - 1, d).getTime(); return [from, from + days * 864e5]; };

test('TZID times are read in their own zone', () => {
  const [from, to] = range(2026, 3, 1, 5);
  const [e] = parseIcs(cal(['UID:a', 'DTSTART;TZID=America/New_York:20260302T090000', 'DTEND;TZID=America/New_York:20260302T100000', 'SUMMARY:NY standup']), from, to);
  assert.equal(new Date(e.start).toISOString(), '2026-03-02T14:00:00.000Z'); // 9:00 EST = 14:00 UTC
  assert.equal(e.end - e.start, 3600e3);
});

test('EXDATE removes an occurrence, RECURRENCE-ID moves one, CANCELLED hides one', () => {
  const [from, to] = range(2026, 6, 1, 7);
  const events = parseIcs(cal(
    ['UID:s', 'DTSTART:20260601T080000Z', 'DTEND:20260601T083000Z', 'RRULE:FREQ=DAILY', 'EXDATE:20260602T080000Z', 'SUMMARY:Daily'],
    ['UID:s', 'RECURRENCE-ID:20260603T080000Z', 'DTSTART:20260603T120000Z', 'DTEND:20260603T123000Z', 'SUMMARY:Daily (moved)'],
    ['UID:s', 'RECURRENCE-ID:20260604T080000Z', 'DTSTART:20260604T080000Z', 'STATUS:CANCELLED', 'SUMMARY:Daily'],
    ['UID:x', 'DTSTART:20260605T100000Z', 'STATUS:CANCELLED', 'SUMMARY:Cancelled meeting'],
  ), from, to);
  const days = events.map((e) => new Date(e.start).toISOString().slice(5, 16));
  assert.ok(!days.includes('06-02T08:00'), 'excluded date stays out');
  assert.ok(days.includes('06-03T12:00') && !days.includes('06-03T08:00'), 'moved occurrence appears once, at its new time');
  assert.ok(!days.includes('06-04T08:00'), 'cancelled occurrence stays out');
  assert.ok(!events.some((e) => e.title === 'Cancelled meeting'));
  assert.ok(days.includes('06-05T08:00'));
});

test('MONTHLY BYDAY=2TU is the second Tuesday, also for series that started years ago', () => {
  const [from, to] = range(2026, 11, 1, 62);
  const events = parseIcs(cal(['UID:m', 'DTSTART:20190108T090000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:Board']), from, to);
  const d = events.map((e) => new Date(e.start));
  assert.deepEqual(d.map((x) => [x.getMonth() + 1, x.getDate(), x.getDay()]), [[11, 10, 2], [12, 8, 2]]);
});

test('a daily series from years ago still shows today', () => {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const events = parseIcs(cal(['UID:d', 'DTSTART:20180101T070000', 'RRULE:FREQ=DAILY', 'SUMMARY:Gym']), now.getTime(), now.getTime() + 864e5);
  assert.equal(events.length, 1);
});
