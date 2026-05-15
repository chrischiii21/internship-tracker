export interface GroupedEntry {
  label: string;
  totalSeconds: number;
  firstDate: string; // ISO string of the first date in this group for sorting
}

export function groupEntries(entries: { date: string, durationSeconds: number }[], paySchedule: string): GroupedEntry[] {
  const groups: Record<string, { totalSeconds: number, firstDate: string }> = {};

  entries.forEach(entry => {
    const date = new Date(entry.date);
    let label = '';

    if (paySchedule === 'weekly') {
      const week = getWeekNumber(date);
      label = `Week ${week} (${date.getFullYear()})`;
    } else if (paySchedule === 'semi-monthly') {
      const day = date.getDate();
      let targetMonth = date;
      
      // If date is 30th or 31st, it belongs to the NEXT month's first payday (15th)
      if (day >= 30) {
        targetMonth = new Date(date.getFullYear(), date.getMonth() + 1, 1);
      }
      
      const monthName = targetMonth.toLocaleString('en-US', { month: 'long' });
      const year = targetMonth.getFullYear();
      
      if (day >= 30 || day <= 14) {
        label = `${monthName} 1st-14th Period (${year})`;
      } else {
        label = `${monthName} 15th-29th Period (${year})`;
      }
    } else {
      // Monthly default
      label = date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    }

    if (!groups[label]) {
      groups[label] = { totalSeconds: 0, firstDate: entry.date };
    } else {
      // Keep the earliest date as the representative
      if (new Date(entry.date) < new Date(groups[label].firstDate)) {
        groups[label].firstDate = entry.date;
      }
    }
    groups[label].totalSeconds += entry.durationSeconds;
  });

  return Object.keys(groups).map(label => ({
    label,
    totalSeconds: groups[label].totalSeconds,
    firstDate: groups[label].firstDate
  })).sort((a, b) => new Date(a.firstDate).getTime() - new Date(b.firstDate).getTime());
}

function getWeekNumber(d: Date): number {
  d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return weekNo;
}
