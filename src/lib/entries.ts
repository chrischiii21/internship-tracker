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

export interface ActiveTimer {
  userId: string;
  startTime: string; // ISO String
  description: string;
}

export async function getActiveTimer(userId: string, isEmployee: boolean = false): Promise<ActiveTimer | null> {
  try {
    const { data, error } = await supabase
      .from('active_timers')
      .select('*')
      .eq('user_id', userId)
      .eq('is_employee', isEmployee)
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

export async function startTimer(userId: string, description: string = '', isEmployee: boolean = false) {
  const { data, error } = await supabase
    .from('active_timers')
    .upsert({
      user_id: userId,
      description,
      start_time: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_employee: isEmployee
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function stopTimer(userId: string, description: string, isEmployee: boolean = false) {
  const timer = await getActiveTimer(userId, isEmployee);
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
      duration_seconds: Math.max(0, durationSeconds),
      is_employee: isEmployee
    });

  if (logError) throw logError;

  const { error } = await supabase
    .from('active_timers')
    .delete()
    .eq('user_id', userId)
    .eq('is_employee', isEmployee);

  if (error) throw error;
}

export async function updateTimerStart(userId: string, startTimeStr: string, isEmployee: boolean = false) {
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
    .eq('user_id', userId)
    .eq('is_employee', isEmployee);

  if (error) throw error;
}
