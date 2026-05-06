import type { APIRoute } from 'astro';
import { getAuthUrl } from '../../../lib/auth';

export const GET: APIRoute = async ({ url }) => {
  const isMobile = url.searchParams.get('source') === 'mobile';
  const authUrl = getAuthUrl(url.origin, isMobile);
  return Response.redirect(authUrl, 302);
};
