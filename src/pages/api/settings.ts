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
    
    // Employee config extraction
    const isProgramForm = formData.has('program') || formData.has('hasAllowance') || formData.has('isEmployee');
    let isEmployee = existingSettings.isEmployee;
    if (isProgramForm) {
      isEmployee = formData.get('isEmployee') === 'true';
    }

    const rawMonthlyRate = formData.get('monthlyRate');
    const monthlyRate = rawMonthlyRate ? parseFloat(rawMonthlyRate as string) : existingSettings.monthlyRate;

    // Handle hasAllowance (checkbox logic: if present in formData it's true, if form submitted but missing it's false, if form not submitted it's existing)
    let hasAllowance = existingSettings.hasAllowance;
    if (isProgramForm && !isEmployee) {
      hasAllowance = formData.get('hasAllowance') === 'true';
    } else if (isEmployee) {
      hasAllowance = false;
    }

    const payType = (formData.get('payType') as 'hourly' | 'daily') || existingSettings.payType;
    const paySchedule = (formData.get('paySchedule') as 'weekly' | 'semi-monthly' | 'monthly') || existingSettings.paySchedule;

    let coordinatorId = existingSettings.coordinatorId;
    let sectionId = existingSettings.sectionId;
    const isUnlink = formData.get('unlink') === 'true';

    if (isUnlink || isEmployee) {
      coordinatorId = null as any;
      sectionId = null as any;
    } else if (role === 'student' && coordinatorInvite) {
      // Find coordinator/section by invite code
      const { supabase } = await import('../../lib/supabase');
      
      // Try to find the invite code in coordinator_sections
      const { data: section } = await supabase
        .from('coordinator_sections')
        .select('id, coordinator_id')
        .eq('invite_code', coordinatorInvite.toUpperCase().trim())
        .maybeSingle();
      
      if (section) {
        coordinatorId = section.coordinator_id;
        sectionId = section.id;
      } else {
        throw new Error('Invalid invite code. Please check with your coordinator.');
      }
    }

    // Only validate fields if user is a student and it's a full setup/update
    if (role === 'student' && setupComplete && isProgramForm) {
      if (isEmployee) {
        if (!startDate || isNaN(monthlyRate)) {
          throw new Error('Invalid data for employee profile. Please ensure employment start date and monthly rate are filled.');
        }
      } else {
        if (!startDate || isNaN(targetHours) || isNaN(hourlyRate)) {
          throw new Error('Invalid data for student profile. Please ensure all required fields are filled.');
        }
      }
    }

    let clockifyEnabled = existingSettings.clockifyEnabled;
    if (formData.get('unlinkClockify') === 'true') {
      clockifyEnabled = false;
    } else if (formData.get('linkClockify') === 'true') {
      clockifyEnabled = true;
    }

    let employeeStartDate = existingSettings.employeeStartDate;
    let employerCompany = existingSettings.employerCompany;
    let employeePaySchedule = existingSettings.employeePaySchedule;

    if (isEmployee) {
      employeeStartDate = formData.get('startDate') as string || existingSettings.employeeStartDate;
      employerCompany = formData.get('hostCompany') as string || existingSettings.employerCompany;
      employeePaySchedule = formData.get('paySchedule') as 'semi-monthly' | 'monthly' || existingSettings.employeePaySchedule;
    }

    await saveAppSettings(session.id, { 
      startDate: isEmployee ? existingSettings.startDate : startDate, 
      targetHours: isEmployee ? existingSettings.targetHours : (isNaN(targetHours) ? undefined : targetHours), 
      hourlyRate: isEmployee ? existingSettings.hourlyRate : (isNaN(hourlyRate) ? undefined : hourlyRate), 
      setupComplete: setupComplete || existingSettings.setupComplete,
      program: isEmployee ? existingSettings.program : program,
      hostCompany: isEmployee ? existingSettings.hostCompany : hostCompany,
      supervisor: isEmployee ? existingSettings.supervisor : supervisor,
      supervisorPosition: isEmployee ? existingSettings.supervisorPosition : supervisorPosition,
      hasAllowance: isEmployee ? existingSettings.hasAllowance : hasAllowance,
      payType: isEmployee ? existingSettings.payType : payType,
      paySchedule: isEmployee ? existingSettings.paySchedule : paySchedule,
      role,
      inviteCode: role === 'coordinator' ? ((inviteCode || existingSettings.inviteCode)?.toUpperCase()) : undefined,
      coordinatorId: isEmployee ? existingSettings.coordinatorId : coordinatorId,
      sectionId: isEmployee ? existingSettings.sectionId : sectionId,
      clockifyEnabled,
      isEmployee,
      monthlyRate: isNaN(monthlyRate) ? undefined : monthlyRate,
      employeeStartDate,
      employerCompany,
      employeePaySchedule,
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
