import type { APIRoute } from 'astro';
import { saveAppSettings, getAppSettings } from '../../lib/settings';
import { getSession } from '../../lib/auth';
import { parse } from 'cookie';

export const POST: APIRoute = async ({ request }) => {
  // Simple auth check
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) {
    return new Response('Unauthorized', { status: 401 });
  }

  let redirectUrl = '/dashboard';
  try {
    const formData = await request.formData();
    const role = formData.get('role') as 'student' | 'coordinator' || 'student';
    
    // Fetch existing settings to merge
    const existingSettings = await getAppSettings(session.id);
    
    const inviteCode = formData.get('inviteCode') as string;
    const coordinatorInvite = formData.get('coordinatorInvite') as string;
    
    // Extract common fields
    const setupComplete = formData.get('setupComplete') === 'true';
    redirectUrl = formData.get('redirect') as string || '/dashboard';
    
    // Extract OJT fields with fallbacks to existing settings
    const startDate = formData.get('startDate') as string || existingSettings.startDate;
    const rawTargetHours = formData.get('targetHours');
    const targetHours = rawTargetHours ? parseFloat(rawTargetHours as string) : existingSettings.targetHours;
    
    const rawHourlyRate = formData.get('hourlyRate');
    const hourlyRate = rawHourlyRate ? parseFloat(rawHourlyRate as string) : existingSettings.hourlyRate;
    
    const program = formData.get('program') as string || existingSettings.program;
    const hostCompany = formData.get('hostCompany') as string || existingSettings.hostCompany;
    const supervisor = formData.get('supervisor') as string || existingSettings.supervisor;
    const supervisorPosition = formData.get('supervisorPosition') as string || existingSettings.supervisorPosition;
    
    // Handle hasAllowance (checkbox logic: if present in formData it's true, if form submitted but missing it's false, if form not submitted it's existing)
    // NOTE: This assumes that if 'program' or 'hostCompany' is present, the OJT/Program form was submitted.
    const isProgramForm = formData.has('program') || formData.has('hasAllowance');
    let hasAllowance = existingSettings.hasAllowance;
    if (isProgramForm) {
      hasAllowance = formData.get('hasAllowance') === 'true';
    }

    const payType = (formData.get('payType') as 'hourly' | 'daily') || existingSettings.payType;
    const paySchedule = (formData.get('paySchedule') as 'weekly' | 'semi-monthly' | 'monthly') || existingSettings.paySchedule;

    let coordinatorId = existingSettings.coordinatorId;
    let sectionId = existingSettings.sectionId;
    const isUnlink = formData.get('unlink') === 'true';

    if (isUnlink) {
      coordinatorId = null as any;
      sectionId = null as any;
    } else if (role === 'student' && coordinatorInvite) {
      // Find coordinator/section by invite code
      const { supabase } = await import('../../lib/supabase');
      
      // 1. Try to find the invite code in coordinator_sections first
      const { data: section } = await supabase
        .from('coordinator_sections')
        .select('id, coordinator_id')
        .eq('invite_code', coordinatorInvite.toUpperCase().trim())
        .maybeSingle();
      
      if (section) {
        coordinatorId = section.coordinator_id;
        sectionId = section.id;
      } else {
        // 2. Try to find the invite code in coordinator_settings as a fallback (general code)
        const { data: coord } = await supabase
          .from('coordinator_settings')
          .select('user_id')
          .eq('invite_code', coordinatorInvite.toUpperCase().trim())
          .maybeSingle();
        
        if (coord) {
          coordinatorId = coord.user_id;
          sectionId = null;
        } else {
          throw new Error('Invalid invite code. Please check with your coordinator.');
        }
      }
    }

    // Only validate OJT fields if user is a student and it's a full setup/update
    if (role === 'student' && setupComplete && isProgramForm) {
      if (!startDate || isNaN(targetHours) || isNaN(hourlyRate)) {
        throw new Error('Invalid data for student profile. Please ensure all required fields are filled.');
      }
    }

    let clockifyEnabled = existingSettings.clockifyEnabled;
    if (formData.get('unlinkClockify') === 'true') {
      clockifyEnabled = false;
    } else if (formData.get('linkClockify') === 'true') {
      clockifyEnabled = true;
    }

    await saveAppSettings(session.id, { 
      startDate, 
      targetHours: isNaN(targetHours) ? undefined : targetHours, 
      hourlyRate: isNaN(hourlyRate) ? undefined : hourlyRate, 
      setupComplete: setupComplete || existingSettings.setupComplete,
      program,
      hostCompany,
      supervisor,
      supervisorPosition,
      hasAllowance,
      payType,
      paySchedule,
      role,
      inviteCode: role === 'coordinator' ? ((inviteCode || existingSettings.inviteCode)?.toUpperCase()) : undefined,
      coordinatorId,
      sectionId,
      clockifyEnabled,
      userName: session.name,
      userEmail: session.email,
      userPicture: session.picture
    });

    const finalUrl = new URL(redirectUrl, request.url);
    const { addSyncLog } = await import('../../lib/logs');
    if (redirectUrl === '/settings') {
      let msg = 'Profile updated successfully';
      if (formData.get('unlinkClockify') === 'true') {
        msg = 'Clockify unlinked';
        await addSyncLog({ userId: session.id, type: 'Mode', status: 'Warning', details: 'Clockify integration disabled' });
      } else if (formData.get('linkClockify') === 'true') {
        msg = 'Clockify linked successfully';
        await addSyncLog({ userId: session.id, type: 'Sync', status: 'Success', details: 'Clockify integration enabled' });
      } else if (formData.get('unlink') === 'true') {
        msg = 'Unlinked from coordinator';
        await addSyncLog({ userId: session.id, type: 'Mode', status: 'Warning', details: 'Unlinked from coordinator' });
      } else if (formData.get('coordinatorInvite')) {
        msg = 'Linked to coordinator successfully';
        await addSyncLog({ userId: session.id, type: 'Mode', status: 'Success', details: 'Linked to a new coordinator' });
      } else {
        await addSyncLog({ userId: session.id, type: 'Settings', status: 'Success', details: 'Internship configuration updated' });
      }
      
      finalUrl.searchParams.set('success', msg);
    }
    return Response.redirect(finalUrl.toString(), 302);
  } catch (e) {
    console.error('Settings save error:', e);
    const finalUrl = new URL(redirectUrl, request.url);
    finalUrl.searchParams.set('error', e.message);
    return Response.redirect(finalUrl.toString(), 302);
  }
};
