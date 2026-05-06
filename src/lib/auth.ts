import { google } from 'googleapis';

const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

import { supabase } from './supabase';

// ... SCOPES and other functions remain same ...

export function getOAuth2Client(origin?: string) {
  // Use the origin from the request if available, otherwise fallback to the environment variable
  const redirectUri = origin 
    ? new URL('/api/auth/callback', origin).toString()
    : import.meta.env.GOOGLE_REDIRECT_URI;

  return new google.auth.OAuth2(
    import.meta.env.GOOGLE_CLIENT_ID,
    import.meta.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

export function getAuthUrl(origin?: string, isMobile?: boolean) {
  const client = getOAuth2Client(origin);
  return client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: isMobile ? 'mobile' : 'web'
  });
}

export async function getUserFromCode(code: string, origin?: string) {
  const client = getOAuth2Client(origin);
  try {
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();

    return {
      id: data.id,
      email: data.email,
      name: data.name,
      picture: data.picture,
      hd: data.hd,
    };
  } catch (error: any) {
    console.error('Error fetching user from code:', error.response?.data || error.message);
    throw error;
  }
}

export async function createSession(user: any): Promise<string> {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString(); // 30 days
  
  const { data, error } = await supabase
    .from('sessions')
    .insert({
      user_data: user,
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) throw error;
  return data.id;
}

export async function getSession(id: string) {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;

    if (new Date() > new Date(data.expires_at)) {
      await destroySession(id);
      return null;
    }

    return data.user_data;
  } catch {
    return null;
  }
}

export async function destroySession(id: string) {
  await supabase.from('sessions').delete().eq('id', id);
}

export async function deleteAccount(userId: string) {
  // Delete all user-related data in order to respect any constraints
  await supabase.from('entries').delete().eq('user_id', userId);
  await supabase.from('active_timers').delete().eq('user_id', userId);
  
  // Attempt to delete from all possible settings tables
  await supabase.from('student_settings').delete().eq('user_id', userId);
  await supabase.from('coordinator_settings').delete().eq('user_id', userId);
  await supabase.from('settings').delete().eq('user_id', userId);
}
