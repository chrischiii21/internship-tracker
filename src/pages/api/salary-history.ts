import type { APIRoute } from 'astro';
import { parse } from 'cookie';
import { getSession } from '../../lib/auth';
import { deleteSalaryChange } from '../../lib/salary';

// Removes one salary history entry (a mistyped raise, say) and returns to Settings.
export const POST: APIRoute = async ({ request }) => {
  const cookies = parse(request.headers.get('cookie') || '');
  const session = cookies.session ? await getSession(cookies.session) : null;
  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  const url = new URL('/settings', request.url);
  try {
    const id = (await request.formData()).get('id') as string;
    if (!id) throw new Error('Missing salary entry');
    await deleteSalaryChange(session.id, id);
    url.searchParams.set('success', 'Salary entry removed');
  } catch (e: any) {
    url.searchParams.set('error', e.message);
  }
  return Response.redirect(url.toString(), 302);
};
