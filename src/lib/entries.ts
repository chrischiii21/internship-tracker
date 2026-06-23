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
}

export async function getManualEntries(userId: string): Promise<TimeEntry[]> {
  try {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .eq('user_id', userId)
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
        endFull: e.end_time
      };
    });
  } catch (e) {
    console.error('Error fetching entries:', e);
    return [];
  }
}

export async function addManualEntry(entry: { userId: string, description: string, date: string, startTime: string, endTime: string }) {
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
      duration_seconds: durationSeconds
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateManualEntry(id: string, entry: { description: string, date: string, startTime: string, endTime: string }) {
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
      duration_seconds: durationSeconds
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

export interface ActiveTimer {
  userId: string;
  startTime: string; // ISO String
  description: string;
}

export async function getActiveTimer(userId: string): Promise<ActiveTimer | null> {
  try {
    const { data, error } = await supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error || !data) return null;

    return {
      userId: data.user_id,
      startTime: data.start_time,
      description: data.description
    };
  } catch {
    return null;
  }
}

export async function startTimer(userId: string, description: string = '') {
  const { data, error } = await supabase
    .from('active_timers')
    .upsert({
      user_id: userId,
      description,
      start_time: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function stopTimer(userId: string, description: string) {
  const timer = await getActiveTimer(userId);
  if (!timer) throw new Error('No active timer found');
  if (!description) throw new Error('Description is required to stop the timer');

  const now = new Date();
  const start = new Date(timer.startTime);
  const durationSeconds = Math.floor((now.getTime() - start.getTime()) / 1000);
  
  const { error: logError } = await supabase
    .from('entries')
    .insert({
      user_id: userId,
      description,
      start_time: start.toISOString(),
      end_time: now.toISOString(),
      duration_seconds: Math.max(0, durationSeconds)
    });

  if (logError) throw logError;

  const { error } = await supabase
    .from('active_timers')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}

export async function updateTimerStart(userId: string, startTimeStr: string) {
  // startTimeStr is HH:mm
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  const ensureSeconds = (t: string) => t.split(':').length === 2 ? `${t}:00` : t;
  const fullStart = new Date(`${dateStr}T${ensureSeconds(startTimeStr)}+08:00`);
  
  const { error } = await supabase
    .from('active_timers')
    .update({
      start_time: fullStart.toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId);

  if (error) throw error;
}
