import type { AppSettings } from './settings';
import type { GroupedEntry } from './grouping';
import type { SalaryChange } from './salary';

// Single source of truth for pay math. The Dashboard tile and the Earnings page used to compute
// this separately and disagreed — notably both ignored the "fixed daily rate" pay model.

// The monthly rate in force on a date. Before the first recorded change, the earliest known rate
// applies; with no history at all, the current setting does.
export function monthlyRateOn(history: SalaryChange[], date: string, fallback: number): number {
  let rate = history[0]?.monthlyRate ?? fallback;
  for (const change of history) {
    if (change.effectiveDate > date) break;
    rate = change.monthlyRate;
  }
  return rate;
}

export function activePaySchedule(settings: AppSettings): string {
  return settings.isEmployee ? (settings.employeePaySchedule || 'monthly') : settings.paySchedule;
}

// What one pay period is worth. Employees earn their salary per period regardless of hours, at the
// rate in force by the period's last logged day — so a raise never re-prices past paydays. Students
// earn either per hour logged or per day attended, depending on their pay model.
// ponytail: a raise effective mid-period pays the whole period at the new rate; prorate if needed.
export function periodEarnings(settings: AppSettings, group: GroupedEntry, salaryHistory: SalaryChange[] = []): number {
  if (settings.isEmployee) {
    const monthly = monthlyRateOn(salaryHistory, group.lastDate, settings.monthlyRate || 0);
    return activePaySchedule(settings) === 'semi-monthly' ? monthly / 2 : monthly;
  }

  const rate = settings.hourlyRate || 0;
  return settings.payType === 'daily'
    ? group.daysWorked * rate
    : (group.totalSeconds / 3600) * rate;
}

export function totalEarnings(settings: AppSettings, groups: GroupedEntry[], salaryHistory: SalaryChange[] = []): number {
  return groups.reduce((sum, group) => sum + periodEarnings(settings, group, salaryHistory), 0);
}

export function totalDaysWorked(groups: GroupedEntry[]): number {
  return groups.reduce((sum, group) => sum + group.daysWorked, 0);
}

export interface PeriodRow {
  label: string;
  rendered: number;
  daysWorked: number;
  calculated: number;
  totalExpected: number;
  actualReceived: number;
  carryOverIn: number;
  carryOverOut: number;
  isAdjusted: boolean;
}

// One row per pay period, oldest first, carrying any under/overpayment forward: whatever a period
// was short by is added to what the next period expects.
export function buildPeriodBreakdown(
  settings: AppSettings,
  groups: GroupedEntry[],
  adjustments: Record<string, number>,
  salaryHistory: SalaryChange[] = [],
): PeriodRow[] {
  let carryOver = 0;

  return groups.map(group => {
    const calculated = periodEarnings(settings, group, salaryHistory);
    const totalExpected = calculated + carryOver;
    const isAdjusted = adjustments[group.label] !== undefined;
    const actualReceived = isAdjusted ? adjustments[group.label] : totalExpected;
    const carryOverIn = carryOver;

    carryOver = totalExpected - actualReceived;

    return {
      label: group.label,
      rendered: group.totalSeconds / 3600,
      daysWorked: group.daysWorked,
      calculated,
      totalExpected,
      actualReceived,
      carryOverIn,
      carryOverOut: carryOver,
      isAdjusted,
    };
  });
}
