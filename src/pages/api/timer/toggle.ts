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

    // The page may be stale — e.g. showing Time Out for a timer auto-stopped at the end of the shift
    // (getActiveTimer just did that). Act on what the user pressed, not a blind flip.
    const mode = body?.mode === 'in' || body?.mode === 'out' ? body.mode : null;
    if (mode && (mode === 'out') !== !!existing) {
      return new Response(JSON.stringify({
        success: true,
        active: !!existing,
        startTime: existing?.startTime ?? null,
        stale: true,
        message: existing
          ? "You're already timed in — the timer was started from another page or device."
          : 'Your timer had already stopped at the end of your shift. Check your DTR if you worked later.',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (existing) {
      const result = await stopTimer(session.id, '', isEmployee, punchTime, existing);
      const hours = (result.durationSeconds / 3600).toFixed(2);
      const shiftEndLabel = new Date(result.endTime).toLocaleString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      const { addSyncLog } = await import('../../../lib/logs');
      await addSyncLog({
        userId: session.id,
        type: 'Sync',
        status: result.capped ? 'Warning' : 'Success',
        details: result.capped
          ? `Timed out — timer ran more than 4h past the shift, so it was saved up to the shift's end (${shiftEndLabel}, ${hours}h)`
          : (punchTime ? `Timed out at ${punchTime} (matched to attendance tap)` : 'Timed out'),
      });
      return new Response(JSON.stringify({
        success: true,
        active: false,
        capped: result.capped,
        message: result.capped
          ? `That timer ran more than 4 hours past your shift, so it was saved up to your shift's end (${shiftEndLabel}, ${hours}h). Edit that day on your DTR if you worked later.`
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
