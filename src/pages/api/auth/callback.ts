import type { APIRoute } from 'astro';
import { getUserFromCode, createSession } from '../../../lib/auth';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error || !code) {
    return Response.redirect(new URL('/?error=auth_failed', url.origin).toString(), 302);
  }

  try {
    const user = await getUserFromCode(code, url.origin);
    const sessionId = await createSession(user);

    // Record login in sync logs
    const { addSyncLog } = await import('../../../lib/logs');
    await addSyncLog({ userId: user.id, type: 'Auth', status: 'Success', details: 'Google Session Established' });

    const state = url.searchParams.get('state');
    
    if (state === 'mobile') {
      // Redirect back to the mobile app with the session ID
      return Response.redirect(`com.calcallowance.app://auth-callback?session=${sessionId}`, 302);
    }

    const headers = new Headers();
    headers.set('Location', '/dashboard');
    headers.set(
      'Set-Cookie',
      `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`
    );

    return new Response(null, { status: 302, headers });
  } catch (err: any) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    const state = url.searchParams.get('state');
    const redirectUrl = state === 'mobile' 
      ? 'com.calcallowance.app://auth-callback?error=auth_failed'
      : new URL('/?error=auth_failed', url.origin).toString();
    return Response.redirect(redirectUrl, 302);
  }
};
