import { supabase } from './supabase';

export interface TimeEntry {
  id: string;
  userId: string;
  description: string;
  date: string; // YYYY-MM-DD (derived)
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  durationSeconds: number;
  startFull: string; // ISO String
  endFull: string; // ISO String
  documentationUrls: string[];
}

export async function getManualEntries(userId: string, isEmployee: boolean = false): Promise<TimeEntry[]> {
  try {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', userId)
      .eq('is_employee', isEmployee)
      .order('start_time', { ascending: false });

    if (error) throw error;
    
    return (data || []).map(e => {
      const start = new Date(e.start_time);
      const end = new Date(e.end_time);
      
      const timeStr = (d: Date) => d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

      return {
        id: e.id,
        userId: e.user_id,
        description: e.description,
        date: dateStr(start),
        startTime: timeStr(start),
        endTime: timeStr(end),
        durationSeconds: e.duration_seconds,
        startFull: e.start_time,
        endFull: e.end_time,
        documentationUrls: e.documentation_urls || []
      };
    });
  } catch (e) {
    console.error('Error fetching entries:', e);
    return [];
  }
}

export async function addManualEntry(entry: { userId: string, description: string, date: string, startTime: string, endTime: string, documentationUrls?: string[], isEmployee?: boolean }) {
  // Combine date and time to create full timestamps in Philippine Time
  const ensureSeconds = (t: string) => t.split(':').length === 2 ? `${t}:00` : t;
  const startStr = `${entry.date}T${ensureSeconds(entry.startTime)}+08:00`;
  const endStr = `${entry.date}T${ensureSeconds(entry.endTime)}+08:00`;
  
  // We handle these as local times for the user (Asia/Manila, UTC+8)
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  if (end < start) throw new Error('End time must be after start time');
  
  const durationSeconds = (end.getTime() - start.getTime()) / 1000;
  
  const { data, error } = await supabase
    .from('entries')
    .insert({
      user_id: entry.userId,
      description: entry.description,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_seconds: durationSeconds,
      documentation_urls: entry.documentationUrls || [],
      is_employee: entry.isEmployee ?? false
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateManualEntry(id: string, entry: { description: string, date: string, startTime: string, endTime: string, documentationUrls?: string[] }) {
  const ensureSeconds = (t: string) => t.split(':').length === 2 ? `${t}:00` : t;
  const startStr = `${entry.date}T${ensureSeconds(entry.startTime)}+08:00`;
  const endStr = `${entry.date}T${ensureSeconds(entry.endTime)}+08:00`;
  
  const start = new Date(startStr);
  const end = new Date(endStr);
  
  if (end < start) throw new Error('End time must be after start time');

  const durationSeconds = (end.getTime() - start.getTime()) / 1000;
  
  const { data, error } = await supabase
    .from('entries')
    .update({
      description: entry.description,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_seconds: durationSeconds,
      documentation_urls: entry.documentationUrls || []
    })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteManualEntry(id: string) {
  const { error } = await supabase
    .from('entries')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// Everything that counts toward hours for a period: Clockify sessions (when syncing is on) plus
// the entries logged in this system. Dates are plain 'YYYY-MM-DD' in Manila time, so they compare
// as strings without dragging the server's timezone into it.
export async function getTrackedEntries(
  userId: string,
  email: string,
  settings: { clockifyEnabled?: boolean; isEmployee?: boolean },
  startDate: string,
): Promise<{ date: string; durationSeconds: number }[]> {
  const collected: { date: string; durationSeconds: number }[] = [];

  const loadClockify = async () => {
    if (settings.clockifyEnabled === false) return;
    try {
      const { getClockifyUser, getRenderedHours } = await import('./clockify');
      const clockifyUser = await getClockifyUser(email);
      if (clockifyUser) {
        const data = await getRenderedHours(clockifyUser.id, startDate);
        collected.push(...data.entries);
      }
    } catch (e) {}
  };

  const [, manual] = await Promise.all([loadClockify(), getManualEntries(userId, settings.isEmployee ?? false)]);
  for (const entry of manual) {
    if (entry.date >= startDate) {
      collected.push({ date: entry.date, durationSeconds: entry.durationSeconds });
    }
  }

  return collected;
}

export interface ActiveTimer {
  userId: string;
  startTime: string; // ISO String
  description: string;
}

// A zero-duration entries row (start_time === end_time) is what a "punch-in only" DTR grid edit
// produces (see /api/dtr/save.ts) — a time-in typed directly into the sheet with no matching
// time-out yet. If today's most recent entry is one of these, the person is effectively "clocked
// in" even though they never touched the Time In/Out button.
async function findOpenManualEntryToday(userId: string, isEmployee: boolean) {
  const todayManila = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const startOfDay = new Date(`${todayManila}T00:00:00+08:00`).toISOString();
  const endOfDay = new Date(`${todayManila}T23:59:59.999+08:00`).toISOString();

  const { data, error } = await supabase
    .from('entries')
    .select('*')
    .eq('user_id', userId)
    .eq('is_employee', isEmployee)
    .gte('start_time', startOfDay)
    .lte('start_time', endOfDay)
    .order('start_time', { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  const latest = data[0];
  return latest.duration_seconds === 0 ? latest : null;
}

async function readActiveTimer(userId: string, isEmployee: boolean): Promise<ActiveTimer | null> {
  try {
    const { data, error } = await supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', userId)
      .eq('is_employee', isEmployee)
      .single();

    if (!error && data) {
      return {
        userId: data.user_id,
        startTime: data.start_time,
        description: data.description
      };
    }

    // No live timer row — check whether a time-in was instead typed straight into the DTR grid.
    // If so, promote it into a real active_timers row so the Time In/Out button (and everything
    // else reading this state) sees it as "currently clocked in" and stays in sync no matter which
    // channel was used to log it.
    const openEntry = await findOpenManualEntryToday(userId, isEmployee);
    if (!openEntry) return null;

    await supabase.from('entries').delete().eq('id', openEntry.id);

    const { data: promoted, error: promoteError } = await supabase
      .from('active_timers')
      .upsert({
        user_id: userId,
        description: openEntry.description || '',
        start_time: openEntry.start_time,
        updated_at: new Date().toISOString(),
        is_employee: isEmployee
      })
      .select()
      .single();

    if (promoteError || !promoted) return null;

    return {
      userId: promoted.user_id,
      startTime: promoted.start_time,
      description: promoted.description
    };
  } catch {
    return null;
  }
}

// The running timer — stopped first if it was left running past its shift. There's no scheduler, so
// the first read after the cutoff (any page, the header, a coordinator's view) does the stopping; the
// entry still ends at the shift's end, exactly as if it had stopped on time.
export async function getActiveTimer(userId: string, isEmployee: boolean = false): Promise<ActiveTimer | null> {
  const timer = await readActiveTimer(userId, isEmployee);
  if (!timer) return null;

  try {
    const start = new Date(timer.startTime);
    const now = new Date();
    const shiftEnd = await forgottenAt(userId, start, now);
    if (!shiftEnd) return timer;

    const seconds = await closeTimer(userId, isEmployee, timer, shiftEnd, timer.description || 'Present');
    if (seconds !== null) {
      const hoursPast = ((now.getTime() - shiftEnd.getTime()) / 3600000).toFixed(1);
      const { addSyncLog } = await import('./logs');
      await addSyncLog({
        userId,
        type: 'Sync',
        status: 'Warning',
        details: `Timer auto-stopped at ${manilaTimeLabel(shiftEnd)}, the end of your shift — it was still running ${hoursPast}h later. Edit that day on your DTR if you worked past it.`,
      });
    }
    return null;
  } catch (e) {
    // Couldn't stop it: leave it running rather than hide a session that still exists.
    console.error('Auto-stop failed:', e);
    return timer;
  }
}

// Punches are entered as the wall-clock time the user read off their company's RFID reader, so
// an HH:mm has to be anchored to a real calendar date in Manila. "Today" is the wrong assumption
// on a shift that crosses midnight, so both directions roll a day when the naive answer is
// impossible — a 10 PM punch-in typed at 00:30 belongs to yesterday, and a 6 AM punch-out on a
// timer started at 10 PM belongs to tomorrow.
const MANILA_TZ = 'Asia/Manila';
// Clock skew between the user's device and the server shouldn't read as "in the future".
const FUTURE_TOLERANCE_MS = 60 * 1000;
// How far back a Time In can be backdated; older days belong in Manual Adjustment.
const FORGOTTEN_TIMER_SECONDS = 24 * 3600;
// How far past the shift's end a session can still run as overtime. Beyond it the timer was
// forgotten rather than worked, and it closes at the shift's end instead.
const OVERTIME_ALLOWANCE_SECONDS = 4 * 3600;

function manilaTimeLabel(d: Date) {
  return d.toLocaleString('en-US', { timeZone: MANILA_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// The shift end a session begun at `start` should have stopped at, if closing it at `at` would run
// past that end by more than the overtime allowance; otherwise null.
async function forgottenAt(userId: string, start: Date, at: Date): Promise<Date | null> {
  // The cutoff is never sooner than the allowance after the start, so short sessions skip the lookup.
  if (at.getTime() - start.getTime() <= OVERTIME_ALLOWANCE_SECONDS * 1000) return null;
  const { getShiftConfig, scheduledShiftEnd } = await import('./shift');
  const shiftEnd = scheduledShiftEnd(await getShiftConfig(userId), start, OVERTIME_ALLOWANCE_SECONDS);
  return at.getTime() > shiftEnd.getTime() + OVERTIME_ALLOWANCE_SECONDS * 1000 ? shiftEnd : null;
}

// Turns the running timer into an entries row and returns its duration, or null if another request
// already closed it. The timer row is claimed first (delete … returning), so an auto-stop racing a
// Time Out logs the session once.
async function closeTimer(userId: string, isEmployee: boolean, timer: ActiveTimer, end: Date, description: string) {
  const { data: claimed, error } = await supabase
    .from('active_timers')
    .delete()
    .eq('user_id', userId)
    .eq('is_employee', isEmployee)
    .eq('start_time', timer.startTime)
    .select();
  if (error) throw error;
  if (!claimed?.length) return null;

  const start = new Date(timer.startTime);
  const durationSeconds = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 1000));
  const { error: logError } = await supabase
    .from('entries')
    .insert({
      user_id: userId,
      description,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      duration_seconds: durationSeconds,
      is_employee: isEmployee
    });
  if (logError) {
    // Put the timer back rather than lose the session.
    await supabase.from('active_timers').upsert(claimed[0]);
    throw logError;
  }
  return durationSeconds;
}

function manilaDateStr(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: MANILA_TZ });
}

function manilaDateTime(dateStr: string, timeStr: string) {
  const withSeconds = timeStr.split(':').length === 2 ? `${timeStr}:00` : timeStr;
  return new Date(`${dateStr}T${withSeconds}+08:00`);
}

function addDays(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return manilaDateStr(d);
}

export function resolvePunchIn(timeStr: string, now: Date = new Date()) {
  let candidate = manilaDateTime(manilaDateStr(now), timeStr);
  if (isNaN(candidate.getTime())) throw new Error('That punch-in time is not a valid time.');
  // A punch-in "later than now" is a shift that started before midnight.
  if (candidate.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    candidate = manilaDateTime(addDays(manilaDateStr(now), -1), timeStr);
  }
  return candidate;
}

export function resolvePunchOut(timeStr: string, start: Date, now: Date = new Date()) {
  let candidate = manilaDateTime(manilaDateStr(start), timeStr);
  if (isNaN(candidate.getTime())) throw new Error('That punch-out time is not a valid time.');
  // A punch-out before the punch-in means the shift ran past midnight.
  if (candidate.getTime() < start.getTime()) {
    candidate = manilaDateTime(addDays(manilaDateStr(start), 1), timeStr);
  }
  // Rolling forward can overshoot into the future — that's a typo, not a night shift.
  if (candidate.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new Error("That time-out is in the future. Check the time you read off the reader.");
  }
  return candidate;
}

export async function startTimer(
  userId: string,
  description: string = '',
  isEmployee: boolean = false,
  punchInTime?: string
) {
  const now = new Date();
  const start = punchInTime ? resolvePunchIn(punchInTime, now) : now;

  // Backdating exists so the timer matches a tap made minutes ago, not to rewrite old days —
  // those belong in Manual Adjustment, which can set both ends.
  if (now.getTime() - start.getTime() > FORGOTTEN_TIMER_SECONDS * 1000) {
    throw new Error('That punch-in is more than a day ago. Use Manual Adjustment to log an earlier day.');
  }

  const { data, error } = await supabase
    .from('active_timers')
    .upsert({
      user_id: userId,
      description,
      start_time: start.toISOString(),
      updated_at: now.toISOString(),
      is_employee: isEmployee
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function stopTimer(
  userId: string,
  description: string,
  isEmployee: boolean = false,
  punchOutTime?: string,
  // The caller usually just read the timer; passing it skips a second identical lookup.
  activeTimer?: ActiveTimer | null
) {
  const timer = activeTimer ?? await getActiveTimer(userId, isEmployee);
  if (!timer) throw new Error('No active timer found');

  // A plain Time In/Out punch has no task description — falls back to whatever the timer already
  // carried (e.g. a description promoted from a manual DTR punch-in) or a generic attendance
  // label, instead of forcing one, since not every stop is "finishing a task."
  const finalDescription = description || timer.description || 'Present';

  const now = new Date();
  const start = new Date(timer.startTime);
  // A punch-out time anchors to the day the timer started (see resolvePunchOut).
  let end = punchOutTime ? resolvePunchOut(punchOutTime, start, now) : now;
  // Too far past the shift's end, the timer was forgotten: it closes at the shift's end — the same
  // place an unattended one is auto-stopped. The header always sends a time (pre-filled with now),
  // so this has to judge typed times too.
  const cutoff = await forgottenAt(userId, start, end);
  if (cutoff) end = cutoff;

  const durationSeconds = await closeTimer(userId, isEmployee, timer, end, finalDescription);
  if (durationSeconds === null) throw new Error('That timer was already stopped.');

  return { capped: !!cutoff, durationSeconds, startTime: start.toISOString(), endTime: end.toISOString() };
}

export async function updateTimerStart(userId: string, startTimeStr: string, isEmployee: boolean = false) {
  // startTimeStr is HH:mm
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const ensureSeconds = (t: string) => t.split(':').length === 2 ? `${t}:00` : t;
  const fullStart = new Date(`${dateStr}T${ensureSeconds(startTimeStr)}+08:00`);
  
  const { data, error } = await supabase
    .from('active_timers')
    .update({
      start_time: fullStart.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .eq('is_employee', isEmployee)
    .select()
    .single();

  if (error) throw error;
  return data;
}
