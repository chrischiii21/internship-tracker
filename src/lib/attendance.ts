import { supabase } from './supabase';

export type AttendanceStatus = 'present' | 'absent' | 'wfh' | 'sl' | 'vl';
export type EffectiveStatus = AttendanceStatus | 'non-working' | 'unmarked';

export interface AttendanceOverride {
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
  isHalfDay: boolean;
}

export interface AttendanceConfig {
  nonWorkingWeekdays: number[]; // 0=Sun..6=Sat
  fullDayHours: number;
}

export const DEFAULT_ATTENDANCE_CONFIG: AttendanceConfig = {
  nonWorkingWeekdays: [0, 6],
  fullDayHours: 8,
};

export interface Holiday {
  id: string;
  date: string; // YYYY-MM-DD
  label: string;
}

export interface DayAttendance {
  day: number;
  date: string; // YYYY-MM-DD
  weekday: number; // 0..6
  totalSeconds: number;
  isHoliday: boolean;
  holidayLabel: string | null;
  isNonWorkingWeekday: boolean;
  status: EffectiveStatus;
  isHalfDay: boolean;
  isUndertime: boolean;
  source: 'override' | 'auto' | 'calendar' | 'none';
}

// Fixed hour bands for auto-derived status from logged time (independent of the configurable
// full-day-hours setting): <5h = half-day, 5-6h = undertime (full day, flagged), >6h = full present.
const HALF_DAY_MAX_HOURS = 5;
const UNDERTIME_MAX_HOURS = 6;

// ---------------- Config (shared across is_employee modes) ----------------

export async function getAttendanceConfig(userId: string): Promise<AttendanceConfig> {
  const { data } = await supabase
    .from('attendance_config')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!data) return { ...DEFAULT_ATTENDANCE_CONFIG };

  return {
    nonWorkingWeekdays: data.non_working_weekdays ?? DEFAULT_ATTENDANCE_CONFIG.nonWorkingWeekdays,
    fullDayHours: data.full_day_hours ?? DEFAULT_ATTENDANCE_CONFIG.fullDayHours,
  };
}

export async function saveAttendanceConfig(userId: string, config: AttendanceConfig): Promise<void> {
  const { error } = await supabase
    .from('attendance_config')
    .upsert({
      user_id: userId,
      non_working_weekdays: config.nonWorkingWeekdays,
      full_day_hours: config.fullDayHours,
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
}

// ---------------- Holidays (shared across is_employee modes) ----------------

export async function getHolidays(userId: string): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from('attendance_holidays')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: true });

  if (error) throw error;

  return (data || []).map(h => ({ id: h.id, date: h.date, label: h.label }));
}

export async function addHoliday(userId: string, date: string, label: string): Promise<Holiday> {
  const { data, error } = await supabase
    .from('attendance_holidays')
    .upsert({ user_id: userId, date, label: label || 'Holiday' }, { onConflict: 'user_id,date' })
    .select()
    .single();

  if (error) throw error;
  return { id: data.id, date: data.date, label: data.label };
}

export async function removeHoliday(userId: string, holidayId: string): Promise<void> {
  const { error } = await supabase
    .from('attendance_holidays')
    .delete()
    .eq('user_id', userId)
    .eq('id', holidayId);

  if (error) throw error;
}

export const MAX_RANGE_DAYS = 90;

// Inclusive list of YYYY-MM-DD dates from start to end. Throws if end < start or the range is too large.
export function expandDateRange(start: string, end: string): string[] {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate < startDate) {
    throw new Error('Invalid date range');
  }

  const dates: string[] = [];
  const cur = new Date(startDate);
  while (cur <= endDate) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
    if (dates.length > MAX_RANGE_DAYS) throw new Error(`Range too large (max ${MAX_RANGE_DAYS} days)`);
  }

  return dates;
}

// True if the date is a holiday or falls on a configured non-working weekday — i.e. a day that
// should never receive a status mark (auto or manual), since no attendance is expected on it.
export function isNonWorkingDate(date: string, config: AttendanceConfig, holidays: Holiday[]): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (config.nonWorkingWeekdays.includes(weekday)) return true;
  return holidays.some(h => h.date === date);
}

// Splits a list of dates into working days (eligible for a status mark) and non-working days
// (weekends/holidays, always skipped so bulk range marks don't paint over days off).
export function partitionWorkingDates(dates: string[], config: AttendanceConfig, holidays: Holiday[]): { working: string[]; nonWorking: string[] } {
  const working: string[] = [];
  const nonWorking: string[] = [];
  for (const date of dates) {
    if (isNonWorkingDate(date, config, holidays)) nonWorking.push(date);
    else working.push(date);
  }
  return { working, nonWorking };
}

// ---------------- Overrides (partitioned by is_employee) ----------------

export async function getOverridesInRange(userId: string, isEmployee: boolean, startDate: string, endDate: string): Promise<AttendanceOverride[]> {
  const { data, error } = await supabase
    .from('attendance_overrides')
    .select('*')
    .eq('user_id', userId)
    .eq('is_employee', isEmployee)
    .gte('date', startDate)
    .lte('date', endDate);

  if (error) throw error;

  return (data || []).map(o => ({ date: o.date, status: o.status, isHalfDay: o.is_half_day }));
}

export async function getOverridesForMonth(userId: string, isEmployee: boolean, month: number, year: number): Promise<AttendanceOverride[]> {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
  return getOverridesInRange(userId, isEmployee, startDate, endDate);
}

export async function saveOverride(userId: string, isEmployee: boolean, date: string, status: AttendanceStatus, isHalfDay: boolean): Promise<AttendanceOverride> {
  const { data, error } = await supabase
    .from('attendance_overrides')
    .upsert({
      user_id: userId,
      is_employee: isEmployee,
      date,
      status,
      is_half_day: isHalfDay,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,is_employee,date' })
    .select()
    .single();

  if (error) throw error;
  return { date: data.date, status: data.status, isHalfDay: data.is_half_day };
}

export async function clearOverride(userId: string, isEmployee: boolean, date: string): Promise<void> {
  const { error } = await supabase
    .from('attendance_overrides')
    .delete()
    .eq('user_id', userId)
    .eq('is_employee', isEmployee)
    .eq('date', date);

  if (error) throw error;
}

// ---------------- Pure computation ----------------

export function computeMonthlyAttendance(
  month: number,
  year: number,
  dailyTotals: Record<number, number>,
  overrides: AttendanceOverride[],
  holidays: Holiday[],
  config: AttendanceConfig
): DayAttendance[] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const overrideByDate = new Map(overrides.map(o => [o.date, o]));
  const holidayByDate = new Map(holidays.map(h => [h.date, h]));

  const result: DayAttendance[] = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const weekday = new Date(year, month - 1, day).getDay();
    const totalSeconds = dailyTotals[day] || 0;
    const holiday = holidayByDate.get(date) || null;
    const isNonWorkingWeekday = config.nonWorkingWeekdays.includes(weekday);
    const override = overrideByDate.get(date);

    let status: EffectiveStatus;
    let isHalfDay: boolean;
    let isUndertime: boolean;
    let source: DayAttendance['source'];

    if (override) {
      status = override.status;
      isHalfDay = override.isHalfDay;
      isUndertime = false;
      source = 'override';
    } else if (totalSeconds > 0) {
      const hours = totalSeconds / 3600;
      status = 'present';
      isHalfDay = hours < HALF_DAY_MAX_HOURS;
      isUndertime = !isHalfDay && hours <= UNDERTIME_MAX_HOURS;
      source = 'auto';
    } else if (holiday || isNonWorkingWeekday) {
      status = 'non-working';
      isHalfDay = false;
      isUndertime = false;
      source = 'calendar';
    } else {
      status = 'unmarked';
      isHalfDay = false;
      isUndertime = false;
      source = 'none';
    }

    result.push({
      day,
      date,
      weekday,
      totalSeconds,
      isHoliday: !!holiday,
      holidayLabel: holiday?.label ?? null,
      isNonWorkingWeekday,
      status,
      isHalfDay,
      isUndertime,
      source,
    });
  }

  return result;
}

// ---------------- Composition ----------------

export async function getMonthlyAttendance(
  userId: string,
  isEmployee: boolean,
  month: number,
  year: number,
  dailyTotals: Record<number, number>
): Promise<{ days: DayAttendance[]; config: AttendanceConfig; holidays: Holiday[] }> {
  const [config, holidays, overrides] = await Promise.all([
    getAttendanceConfig(userId),
    getHolidays(userId),
    getOverridesForMonth(userId, isEmployee, month, year),
  ]);

  const days = computeMonthlyAttendance(month, year, dailyTotals, overrides, holidays, config);

  return { days, config, holidays };
}
