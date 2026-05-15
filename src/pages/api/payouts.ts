import type { AstroActivity } from 'astro';
import { getSession } from '../../lib/auth';
import { savePayoutAdjustment } from '../../lib/payouts';
import { parse } from 'cookie';

export async function POST({ request }: { request: Request }) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const user = cookies.session ? await getSession(cookies.session) : null;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const formData = await request.formData();
    const periodLabel = formData.get('periodLabel') as string;
    const amountReceived = parseFloat(formData.get('amountReceived') as string);
    const redirect = formData.get('redirect') as string || '/dashboard';

    if (!periodLabel || isNaN(amountReceived)) {
      return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400 });
    }

    await savePayoutAdjustment(user.id, periodLabel, amountReceived);

    const redirectUrl = new URL(redirect, request.url);
    redirectUrl.searchParams.set('success', 'Payout adjustment saved');
    return Response.redirect(redirectUrl);
  } catch (error: any) {
    console.error('Payout API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
