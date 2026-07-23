import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parse } from 'cookie';
import { getAppSettings } from '../../../lib/settings';
import { addHoliday, removeHoliday } from '../../../lib/attendance';

async function requireEditableSession(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) return { error: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } }) };

  const settings = await getAppSettings(session.id);
  if (settings.role === 'coordinator') {
    return { error: new Response(JSON.stringify({ error: 'Coordinators cannot edit attendance holidays' }), { status: 403, headers: { 'Content-Type': 'application/json' } }) };
  }

  return { session };
}

export const POST: APIRoute = async ({ request }) => {
  const { session, error } = await requireEditableSession(request);
  if (error) return error;

  try {
    const { date, label } = await request.json();

    if (!date) {
      return new Response(JSON.stringify({ error: 'Missing date' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const holiday = await addHoliday(session!.id, date, label);

    return new Response(JSON.stringify({ success: true, holiday }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error adding holiday:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const DELETE: APIRoute = async ({ request }) => {
  const { session, error } = await requireEditableSession(request);
  if (error) return error;

  try {
    const { id } = await request.json();

    if (!id) {
      return new Response(JSON.stringify({ error: 'Missing id' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await removeHoliday(session!.id, id);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error removing holiday:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
