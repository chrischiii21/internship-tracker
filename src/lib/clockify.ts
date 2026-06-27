import { supabase } from './supabase';

const CLOCKIFY_API_URL = 'https://api.clockify.me/api/v1';

// In-memory cache for Clockify lookup and time entry responses to speed up page rendering
const userCache = new Map<string, { data: any, expiry: number }>();
const hoursCache = new Map<string, { data: any, expiry: number }>();
const dtrEntriesCache = new Map<string, { data: any, expiry: number }>();
const detailedEntriesCache = new Map<string, { data: any, expiry: number }>();

export async function getClockifyUser(email: string) {
  const cacheKey = email.toLowerCase();
  const cached = userCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const apiKey = import.meta.env.CLOCKIFY_API_KEY;
  const workspaceId = import.meta.env.CLOCKIFY_WORKSPACE_ID;
  if (!apiKey || !workspaceId) return null;
  try {
    const response = await fetch(`${CLOCKIFY_API_URL}/workspaces/${workspaceId}/users`, {
      headers: { 'X-Api-Key': apiKey },
    });
    if (!response.ok) return null;
    const users = await response.json();
    const user = users.find((u: any) => u.email.toLowerCase() === cacheKey);
    
    // Cache user lookup for 30 minutes
    userCache.set(cacheKey, { data: user, expiry: Date.now() + 30 * 60 * 1000 });
    return user;
  } catch { return null; }
}

export async function getRenderedHours(clockifyUserId: string, startDate?: string) {
  const cacheKey = `${clockifyUserId}_${startDate || ''}`;
  const cached = hoursCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const apiKey = import.meta.env.CLOCKIFY_API_KEY;
  const workspaceId = import.meta.env.CLOCKIFY_WORKSPACE_ID;
  let totalSeconds = 0;
  let page = 1;
  const pageSize = 50;
  let hasMore = true;
  const allEntries: { date: string, durationSeconds: number }[] = [];

  while (hasMore) {
    const start = startDate ? new Date(startDate).toISOString() : '2024-01-01T00:00:00Z';
    const response = await fetch(
      `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/user/${clockifyUserId}/time-entries?page=${page}&page-size=${pageSize}&start=${start}`,
      { headers: { 'X-Api-Key': apiKey } }
    );
    if (!response.ok) break;
    const entries = await response.json();
    if (entries.length === 0) {
      hasMore = false;
    } else {
      for (const entry of entries) {
        if (entry.timeInterval && entry.timeInterval.duration) {
          const seconds = parseIsoDuration(entry.timeInterval.duration);
          totalSeconds += seconds;
          const date = new Date(entry.timeInterval.start);
          const isoDate = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
          allEntries.push({ date: isoDate, durationSeconds: seconds });
        }
      }
      page++;
      if (entries.length < pageSize) hasMore = false;
    }
  }
  const result = { totalHours: totalSeconds / 3600, entries: allEntries };
  // Cache rendered hours summary for 2 minutes
  hoursCache.set(cacheKey, { data: result, expiry: Date.now() + 2 * 60 * 1000 });
  return result;
}

export async function getStudentProgress(userId: string, email: string, startDate?: string) {
  const { data: settings } = await supabase.from('student_settings').select('rendered_hours, clockify_enabled').eq('user_id', userId).single();
  let manualHours = settings?.rendered_hours || 0;
  let clockifyHours = 0;
  if (settings?.clockify_enabled !== false) {
    try {
      const clockifyUser = await getClockifyUser(email);
      if (clockifyUser) {
        const data = await getRenderedHours(clockifyUser.id, startDate);
        clockifyHours = data.totalHours;
      }
    } catch (e) {}
  }
  return Number(manualHours) + clockifyHours;
}

export async function getDailyDTR(clockifyUserId: string, month: number, year: number, manualEntries: any[] = []) {
  const apiKey = import.meta.env.CLOCKIFY_API_KEY;
  const workspaceId = import.meta.env.CLOCKIFY_WORKSPACE_ID;
  const dtr: Record<number, any> = {};
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let i = 1; i <= daysInMonth; i++) {
    dtr[i] = { amIn: '', amOut: '', pmIn: '', pmOut: '', totalSeconds: 0 };
  }

  const format12 = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour: 'numeric', 
      minute: '2-digit', 
      hour12: true, 
      timeZone: 'Asia/Manila' 
    });
  };

  const allEntries: { start: Date, end: Date, duration: number }[] = [];

  // 1. Collect Manual Entries
  for (const entry of manualEntries) {
    try {
      const s = new Date(entry.startFull);
      const e = new Date(entry.endFull);
      if (!isNaN(s.getTime())) {
        allEntries.push({ start: s, end: e, duration: entry.durationSeconds });
      }
    } catch (e) {}
  }

  // 2. Collect Clockify Entries
  if (clockifyUserId && apiKey && workspaceId) {
    const cacheKey = `${clockifyUserId}_${year}_${month}`;
    const cached = dtrEntriesCache.get(cacheKey);
    let clockifyEntries = [];

    if (cached && cached.expiry > Date.now()) {
      clockifyEntries = cached.data;
    } else {
      try {
        const startIso = new Date(year, month - 1, 1).toISOString();
        const endIso = new Date(year, month, 0, 23, 59, 59).toISOString();
        const response = await fetch(
          `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/user/${clockifyUserId}/time-entries?start=${startIso}&end=${endIso}&page-size=1000`,
          { headers: { 'X-Api-Key': apiKey } }
        );
        if (response.ok) {
          clockifyEntries = await response.json();
          // Cache monthly entries for 2 minutes
          dtrEntriesCache.set(cacheKey, { data: clockifyEntries, expiry: Date.now() + 2 * 60 * 1000 });
        }
      } catch (e) {}
    }

    for (const entry of clockifyEntries) {
      if (entry.timeInterval && entry.timeInterval.end) {
        const s = new Date(entry.timeInterval.start);
        const e = new Date(entry.timeInterval.end);
        const dur = parseIsoDuration(entry.timeInterval.duration);
        allEntries.push({ start: s, end: e, duration: dur });
      }
    }
  }

  // 3. Process day-by-day
  const dailyGroups: Record<number, typeof allEntries> = {};
  allEntries.forEach(entry => {
    const dayStr = new Intl.DateTimeFormat('en-US', { day: 'numeric', timeZone: 'Asia/Manila' }).format(entry.start);
    const day = parseInt(dayStr);
    if (!dailyGroups[day]) dailyGroups[day] = [];
    dailyGroups[day].push(entry);
  });

  for (const [day, dayLogs] of Object.entries(dailyGroups)) {
    const d = parseInt(day);
    if (!dtr[d]) continue;

    dayLogs.sort((a, b) => a.start.getTime() - b.start.getTime());

    const firstStartH = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(dayLogs[0].start));
    
    dtr[d].totalSeconds = dayLogs.reduce((acc, log) => acc + log.duration, 0);

    if (firstStartH >= 12) {
      dtr[d].pmIn = format12(dayLogs[0].start);
      dtr[d].pmOut = format12(dayLogs[dayLogs.length - 1].end);
    } else {
      let lunchBreakIndex = -1;
      let maxGap = 0;
      if (dayLogs.length > 1) {
        for (let i = 0; i < dayLogs.length - 1; i++) {
          const end = dayLogs[i].end.getTime();
          const nextStart = dayLogs[i + 1].start.getTime();
          const gap = nextStart - end;
          
          if (gap < 60 * 1000) continue; // Skip overlaps or tiny gaps (< 1 min)

          const endH = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(dayLogs[i].end));
          
          // Any gap starting between 10 AM and 3 PM is a candidate for lunch break
          if (endH >= 10 && endH <= 15) {
             if (gap >= maxGap) {
               maxGap = gap;
               lunchBreakIndex = i;
             }
          }
        }
      }

      if (lunchBreakIndex !== -1) {
        dtr[d].amIn = format12(dayLogs[0].start);
        dtr[d].amOut = format12(dayLogs[lunchBreakIndex].end);
        dtr[d].pmIn = format12(dayLogs[lunchBreakIndex + 1].start);
        dtr[d].pmOut = format12(dayLogs[dayLogs.length - 1].end);
      } else {
        dtr[d].amIn = format12(dayLogs[0].start);
        const lastEnd = dayLogs[dayLogs.length - 1].end;
        const lastEndH = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(lastEnd));
        
        if (lastEndH >= 13) {
          dtr[d].pmOut = format12(lastEnd);
        } else {
          dtr[d].amOut = format12(lastEnd);
        }
      }
    }
  }

  // Convert back to sorted list for the DTR page
  const days = Object.keys(dtr).map(d => ({ day: d, ...dtr[parseInt(d)] }));
  const totalMonthlyHours = days.reduce((acc, d) => acc + (d.totalSeconds / 3600), 0);
  return { days, totalMonthlyHours };
}

function parseIsoDuration(duration: string) {
  if (!duration) return 0;
  const regex = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/;
  const matches = duration.match(regex);
  if (!matches) return 0;
  return (parseInt(matches[1] || '0') * 86400) + (parseInt(matches[2] || '0') * 3600) + (parseInt(matches[3] || '0') * 60) + parseInt(matches[4] || '0');
}

export async function getClockifyDetailedEntries(clockifyUserId: string, startDate?: string) {
  const cacheKey = `${clockifyUserId}_${startDate || ''}`;
  const cached = detailedEntriesCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.data;
  }

  const apiKey = import.meta.env.CLOCKIFY_API_KEY;
  const workspaceId = import.meta.env.CLOCKIFY_WORKSPACE_ID;
  if (!clockifyUserId || !apiKey || !workspaceId) return [];

  let page = 1;
  const pageSize = 50;
  let hasMore = true;
  const allEntries: any[] = [];

  while (hasMore) {
    const start = startDate ? new Date(startDate).toISOString() : '2024-01-01T00:00:00Z';
    try {
      const response = await fetch(
        `${CLOCKIFY_API_URL}/workspaces/${workspaceId}/user/${clockifyUserId}/time-entries?page=${page}&page-size=${pageSize}&start=${start}&hydrated=true`,
        { headers: { 'X-Api-Key': apiKey } }
      );
      if (!response.ok) break;
      const entries = await response.json();
      if (entries.length === 0) {
        hasMore = false;
      } else {
        for (const entry of entries) {
          if (entry.timeInterval && entry.timeInterval.duration) {
            const seconds = parseIsoDuration(entry.timeInterval.duration);
            const startD = new Date(entry.timeInterval.start);
            const endD = entry.timeInterval.end ? new Date(entry.timeInterval.end) : new Date();
            
            const isoDate = startD.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
            const startTime = startD.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' });
            const endTime = entry.timeInterval.end 
              ? endD.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila' })
              : '';

            const taskName = entry.task && entry.task.name ? entry.task.name : '';
            const rawDescription = entry.description || '';
            let description = 'General Work';
            if (taskName && rawDescription) {
              description = `${taskName}: ${rawDescription}`;
            } else if (taskName) {
              description = taskName;
            } else if (rawDescription) {
              description = rawDescription;
            }

            allEntries.push({
              id: entry.id,
              description,
              date: isoDate,
              startTime,
              endTime,
              durationSeconds: seconds,
              documentationUrls: [],
              type: 'clockify'
            });
          }
        }
        page++;
        if (entries.length < pageSize) hasMore = false;
      }
    } catch (error) {
      console.error('Error fetching detailed Clockify entries:', error);
      break;
    }
  }
  // Cache detailed entries for 2 minutes
  detailedEntriesCache.set(cacheKey, { data: allEntries, expiry: Date.now() + 2 * 60 * 1000 });
  return allEntries;
}
