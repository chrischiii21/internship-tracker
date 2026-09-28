import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parse } from 'cookie';
import { getAppSettings } from '../../../lib/settings';
import { getManualEntries } from '../../../lib/entries';
import { getClockifyUser, getClockifyDetailedEntries } from '../../../lib/clockify';
import { supabase } from '../../../lib/supabase';

// Backs the Attendance Chart's "view time logs for this day" modal — the calendar only shows a
// daily total, this lists the individual sessions (manual + Clockify) that made it up.
export const GET: APIRoute = async ({ request, url }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const date = url.searchParams.get('date') || '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({ error: 'Invalid date' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const mySettings = await getAppSettings(session.id);
  const targetStudentId = url.searchParams.get('studentId');
  let viewUserId = session.id;

  // Same view-only resolution as the Attendance Chart page: a coordinator may only look at
  // students actually assigned to them.
  if (targetStudentId && targetStudentId !== session.id) {
    if (mySettings.role !== 'coordinator') {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { data: student } = await supabase
      .from('student_settings')
      .select('user_id')
      .eq('coordinator_id', session.id)
      .eq('user_id', targetStudentId)
      .single();
    if (!student) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    viewUserId = targetStudentId;
  }

  const settings = await getAppSettings(viewUserId);
  const modeParam = url.searchParams.get('mode');
  const isEmployee = mySettings.role === 'coordinator' && modeParam
    ? modeParam === 'employee'
    : (settings.isEmployee ?? false);

  const manual = await getManualEntries(viewUserId, isEmployee);
  const items = manual
    .filter((e) => e.date === date)
    .map((e) => ({
      description: e.description || 'General Work',
      startTime: e.startTime,
      endTime: e.endTime,
      durationSeconds: e.durationSeconds,
      source: 'manual' as const,
    }));

  if (settings.clockifyEnabled !== false) {
    try {
      const clockifyUser = await getClockifyUser(settings.userEmail || '');
      if (clockifyUser) {
        const clockifyEntries = await getClockifyDetailedEntries(clockifyUser.id, date);
        for (const e of clockifyEntries) {
          if (e.date !== date) continue;
          items.push({
            description: e.description || 'General Work',
            startTime: e.startTime,
            endTime: e.endTime,
            durationSeconds: e.durationSeconds,
            source: 'clockify',
          });
        }
      }
    } catch (e) {}
  }

  items.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  const totalSeconds = items.reduce((sum, e) => sum + (e.durationSeconds || 0), 0);

  return new Response(JSON.stringify({ date, items, totalSeconds }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
