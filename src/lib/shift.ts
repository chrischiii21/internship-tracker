import { supabase } from './supabase';

// Four time-of-day bands the actual shift start can fall into, plus 'custom' for anything that
// doesn't fit the pattern:
//   day       — starts morning, ends evening (standard daytime shift)
//   mid-day   — starts midday, ends at night (afternoon/closing-type shift)
//   mid-night — starts at dawn, ends in the afternoon (early/opening-type shift)
//   night     — starts at night, ends sometime during the day (crosses midnight)
export type ShiftType = 'day' | 'mid-day' | 'mid-night' | 'night' | 'custom';

export interface ShiftConfig {
  shiftType: ShiftType;
  shiftStart: string; // HH:mm
  shiftEnd: string; // HH:mm
}

export const DEFAULT_SHIFT_CONFIG: ShiftConfig = {
  shiftType: 'day',
  shiftStart: '08:00',
  shiftEnd: '17:00',
};

// Presets used by the settings UI when a user picks a category instead of typing exact times.
export const SHIFT_PRESETS: Record<Exclude<ShiftType, 'custom'>, { shiftStart: string; shiftEnd: string; label: string }> = {
  day: { shiftStart: '08:00', shiftEnd: '17:00', label: 'Day Shift — starts morning, ends evening (e.g. 8 AM – 5 PM)' },
  'mid-day': { shiftStart: '12:00', shiftEnd: '21:00', label: 'Mid-Day Shift — starts midday, ends at night (e.g. 12 PM – 9 PM)' },
  'mid-night': { shiftStart: '05:00', shiftEnd: '14:00', label: 'Mid-Night Shift — starts at dawn, ends in the afternoon (e.g. 5 AM – 2 PM)' },
  night: { shiftStart: '21:00', shiftEnd: '06:00', label: 'Night Shift — starts at night, ends during the day (e.g. 9 PM – 6 AM)' },
};

export async function getShiftConfig(userId: string): Promise<ShiftConfig> {
  const { data } = await supabase
    .from('shift_config')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!data) return { ...DEFAULT_SHIFT_CONFIG };

  return {
    shiftType: data.shift_type ?? DEFAULT_SHIFT_CONFIG.shiftType,
    shiftStart: (data.shift_start ?? DEFAULT_SHIFT_CONFIG.shiftStart).slice(0, 5),
    shiftEnd: (data.shift_end ?? DEFAULT_SHIFT_CONFIG.shiftEnd).slice(0, 5),
  };
}

// Length of one shift in seconds, handling shifts that cross midnight (e.g. 21:00 → 06:00).
export function shiftLengthSeconds(config: ShiftConfig): number {
  const toSeconds = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60;
  };

  const start = toSeconds(config.shiftStart);
  const end = toSeconds(config.shiftEnd);
  const length = end > start ? end - start : end + 86400 - start;
  return length > 0 ? length : 8 * 3600;
}

// When a session that began at `start` is due to end: the next time this shift ends after it (6 AM
// the next morning on a 9 PM – 6 AM shift). A session begun far outside shift hours — the next end
// is more than a shift plus `slackSeconds` away — gets one shift's length instead. Manila has no
// DST, so the fixed +08:00 offset is exact.
export function scheduledShiftEnd(config: ShiftConfig, start: Date, slackSeconds: number): Date {
  const length = shiftLengthSeconds(config);
  const day = start.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  let end = new Date(`${day}T${config.shiftEnd}:00+08:00`);
  if (end.getTime() <= start.getTime()) end = new Date(end.getTime() + 86400 * 1000);
  return end.getTime() - start.getTime() <= (length + slackSeconds) * 1000
    ? end
    : new Date(start.getTime() + length * 1000);
}

export async function saveShiftConfig(userId: string, config: ShiftConfig): Promise<void> {
  const { error } = await supabase
    .from('shift_config')
    .upsert({
      user_id: userId,
      shift_type: config.shiftType,
      shift_start: config.shiftStart,
      shift_end: config.shiftEnd,
      updated_at: new Date().toISOString(),
    });

  if (error) throw error;
}
