import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parse } from 'cookie';
import { getAppSettings } from '../../../lib/settings';
import { getActiveTimer, startTimer, stopTimer } from '../../../lib/entries';

// Global Time In / Time Out control (Header widget). Reuses the same active_timers/entries
// plumbing as the Dashboard's task timer — starting or stopping here is reflected there too,
// since both read/write the same row keyed by (user_id, is_employee).
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
    const settings = await getAppSettings(session.id);
    if (settings.role === 'coordinator') {
      return new Response(JSON.stringify({ error: 'Coordinators cannot clock in/out' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // The header's punch modal sends the wall-clock time the user read off their company's
    // attendance reader, so the entry matches that record instead of whenever they got around
    // to opening this app. Absent or malformed, the punch falls back to "now".
    const body = await request.json().catch(() => ({} as any));
    const punchTime = typeof body?.time === 'string' && /^\d{2}:\d{2}$/.test(body.time)
      ? body.time
      : undefined;

    const isEmployee = settings.isEmployee ?? false;
    const existing = await getActiveTimer(session.id, isEmployee);

    if (existing) {
      const result = await stopTimer(session.id, '', isEmployee, punchTime);
      const hours = (result.durationSeconds / 3600).toFixed(2);
      const { addSyncLog } = await import('../../../lib/logs');
      await addSyncLog({
        userId: session.id,
        type: 'Sync',
        status: result.capped ? 'Warning' : 'Success',
        details: result.capped
          ? `Timed out — timer had been left running since ${new Date(result.startTime).toLocaleString('en-US', { timeZone: 'Asia/Manila' })}; saved one shift (${hours}h) instead of the full gap`
          : (punchTime ? `Timed out at ${punchTime} (matched to attendance tap)` : 'Timed out'),
      });
      return new Response(JSON.stringify({
        success: true,
        active: false,
        capped: result.capped,
        message: result.capped
          ? `That timer had been running since ${new Date(result.startTime).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric' })}. Saved one shift (${hours}h) — edit that day on your DTR if the real time-out was different.`
          : null,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } else {
      const started = await startTimer(session.id, '', isEmployee, punchTime);
      const { addSyncLog } = await import('../../../lib/logs');
      await addSyncLog({
        userId: session.id,
        type: 'Sync',
        status: 'Success',
        details: punchTime ? `Timed in at ${punchTime} (matched to attendance tap)` : 'Timed in',
      });
      return new Response(JSON.stringify({ success: true, active: true, startTime: started?.start_time ?? null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (err: any) {
    console.error('Error toggling timer:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
