import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parse } from 'cookie';
import { getAppSettings } from '../../../lib/settings';
import { saveAttendanceConfig } from '../../../lib/attendance';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { nonWorkingWeekdays, fullDayHours } = await request.json();

    if (!Array.isArray(nonWorkingWeekdays) || nonWorkingWeekdays.some((w: any) => !Number.isInteger(w) || w < 0 || w > 6)) {
      return new Response(JSON.stringify({ error: 'nonWorkingWeekdays must be integers 0-6' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (typeof fullDayHours !== 'number' || fullDayHours <= 0) {
      return new Response(JSON.stringify({ error: 'fullDayHours must be a positive number' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const settings = await getAppSettings(session.id);

    if (settings.role === 'coordinator') {
      return new Response(JSON.stringify({ error: 'Coordinators cannot edit attendance config' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await saveAttendanceConfig(session.id, { nonWorkingWeekdays, fullDayHours });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error saving attendance config:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
