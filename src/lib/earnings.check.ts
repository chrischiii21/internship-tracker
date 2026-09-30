// Self-check for the salary-history pay math. Run: node src/lib/earnings.check.ts
import assert from 'node:assert/strict';
import { monthlyRateOn, periodEarnings } from './earnings.ts';

const history = [
  { id: 'a', monthlyRate: 30000, effectiveDate: '2026-01-01' },
  { id: 'b', monthlyRate: 35000, effectiveDate: '2026-06-01' },
];

assert.equal(monthlyRateOn(history, '2025-12-15', 99), 30000, 'before the first change: earliest known rate');
assert.equal(monthlyRateOn(history, '2026-05-31', 99), 30000);
assert.equal(monthlyRateOn(history, '2026-06-01', 99), 35000, 'the effective date itself is the new rate');
assert.equal(monthlyRateOn([], '2026-06-01', 99), 99, 'no history: current setting');

const employee = { isEmployee: true, monthlyRate: 35000, employeePaySchedule: 'semi-monthly' } as any;
const period = (firstDate: string, lastDate: string) => ({ label: '', totalSeconds: 0, daysWorked: 0, firstDate, lastDate });

// A raise on Jun 1 leaves May's pay alone...
assert.equal(periodEarnings(employee, period('2026-05-15', '2026-05-29'), history), 15000);
// ...and the Jun 1st-14th period that starts with the May 30 rollover day still gets it.
assert.equal(periodEarnings(employee, period('2026-05-30', '2026-06-12'), history), 17500);

console.log('earnings.check: ok');
