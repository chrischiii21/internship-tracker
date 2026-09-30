export interface GroupedEntry {
  label: string;
  totalSeconds: number;
  daysWorked: number; // distinct dates with logged time — what a fixed daily rate is paid on
  firstDate: string; // ISO string of the first date in this group for sorting
  lastDate: string; // latest date in the group — decides which salary rate the period is paid at
}

export function groupEntries(entries: { date: string, durationSeconds: number }[], paySchedule: string): GroupedEntry[] {
  const groups: Record<string, { totalSeconds: number, dates: Set<string>, firstDate: string, lastDate: string }> = {};

  entries.forEach(entry => {
    // Dates arrive as plain 'YYYY-MM-DD' in Manila time. Reading them through the runtime's local
    // timezone would push an entry into the wrong period on any server west of UTC, so the parts
    // are used directly.
    const [year, month, day] = entry.date.split('-').map(Number);
    if (!year || !month || !day) return;

    let label = '';

    if (paySchedule === 'weekly') {
      label = `Week ${getWeekNumber(year, month, day)} (${year})`;
    } else if (paySchedule === 'semi-monthly') {
      // The 30th/31st fall after the second cut-off, so they're paid with the next month's first period.
      const rollsOver = day >= 30;
      const periodYear = rollsOver && month === 12 ? year + 1 : year;
      const periodMonth = rollsOver ? (month === 12 ? 1 : month + 1) : month;

      label = rollsOver || day <= 14
        ? `${monthName(periodMonth)} 1st-14th Period (${periodYear})`
        : `${monthName(periodMonth)} 15th-29th Period (${periodYear})`;
    } else {
      label = `${monthName(month)} ${year}`;
    }

    if (!groups[label]) {
      groups[label] = { totalSeconds: 0, dates: new Set(), firstDate: entry.date, lastDate: entry.date };
    } else {
      // ISO dates sort lexicographically, so no Date parsing is needed to find the ends.
      if (entry.date < groups[label].firstDate) groups[label].firstDate = entry.date;
      if (entry.date > groups[label].lastDate) groups[label].lastDate = entry.date;
    }

    groups[label].totalSeconds += entry.durationSeconds;
    // An open punch (start === end) hasn't produced a worked day yet.
    if (entry.durationSeconds > 0) groups[label].dates.add(entry.date);
  });

  return Object.keys(groups)
    .map(label => ({
      label,
      totalSeconds: groups[label].totalSeconds,
      daysWorked: groups[label].dates.size,
      firstDate: groups[label].firstDate,
      lastDate: groups[label].lastDate,
    }))
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

function getWeekNumber(year: number, month: number, day: number): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}
