import type { APIRoute } from 'astro';
import { getAuthUrl } from '../../../lib/auth';

export const GET: APIRoute = async ({ url }) => {
  const authUrl = await getAuthUrl(url.origin);
  return Response.redirect(authUrl, 302);
};
