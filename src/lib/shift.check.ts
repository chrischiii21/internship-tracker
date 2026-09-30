// Self-check for where a forgotten timer gets cut. Run: npx tsx src/lib/shift.check.ts
import assert from 'node:assert/strict';
import { scheduledShiftEnd } from './shift';

const SLACK = 4 * 3600; // the overtime allowance entries.ts passes in
const at = (s: string) => new Date(`${s}+08:00`);
const end = (shiftStart: string, shiftEnd: string, start: string) =>
  scheduledShiftEnd({ shiftType: 'custom', shiftStart, shiftEnd }, at(start), SLACK).toISOString();

// Day shift 8 AM – 5 PM: early, on time and late starts all end at 5 PM that day.
assert.equal(end('08:00', '17:00', '2026-09-30T07:10:00'), at('2026-09-30T17:00:00').toISOString());
assert.equal(end('08:00', '17:00', '2026-09-30T09:30:00'), at('2026-09-30T17:00:00').toISOString());
// Started after the shift (off-hours work): one shift's length from the start, not tomorrow 5 PM.
assert.equal(end('08:00', '17:00', '2026-09-30T18:30:00'), at('2026-10-01T03:30:00').toISOString());

// Night shift 9 PM – 6 AM crosses midnight: ends 6 AM the next morning...
assert.equal(end('21:00', '06:00', '2026-09-30T20:50:00'), at('2026-10-01T06:00:00').toISOString());
// ...and a start after midnight still belongs to the shift ending that morning.
assert.equal(end('21:00', '06:00', '2026-10-01T01:00:00'), at('2026-10-01T06:00:00').toISOString());

// Mid-night (dawn) shift 5 AM – 2 PM.
assert.equal(end('05:00', '14:00', '2026-09-30T04:55:00'), at('2026-09-30T14:00:00').toISOString());

console.log('shift.check: ok');
