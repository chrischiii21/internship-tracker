import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parse } from 'cookie';
import { supabase } from '../../../lib/supabase';
import { getAppSettings } from '../../../lib/settings';

export const POST: APIRoute = async ({ request }) => {
  // Simple auth check
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const { userId, year, month, day, amIn, amOut, pmIn, pmOut } = await request.json();

    if (!userId || !year || !month || !day) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Auth check: Is requesting user the target student or their coordinator?
    const isOwner = session.id === userId;
    const settings = await getAppSettings(userId);
    const isCoordinator = settings.coordinatorId === session.id;

    if (!isOwner && !isCoordinator) {
      return new Response(JSON.stringify({ error: 'Unauthorized to modify this DTR' }), { 
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    // Helper: validate end is after start
    const validateShift = (startT: string, endT: string) => {
      const s = new Date(`${dateStr}T${startT}:00+08:00`);
      const e = new Date(`${dateStr}T${endT}:00+08:00`);
      return e.getTime() > s.getTime();
    };

    // Parse shifts
    const shiftsToInsert = [];

    // Check for single continuous shift: amIn is set, pmOut is set, others are empty
    if (amIn && pmOut && !amOut && !pmIn) {
      if (!validateShift(amIn, pmOut)) {
        return new Response(JSON.stringify({ error: `Out must be after In for Day ${day}` }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      shiftsToInsert.push({ start: amIn, end: pmOut });
    } else {
      // Normal AM shift
      if (amIn) {
        if (amOut) {
          if (!validateShift(amIn, amOut)) {
            return new Response(JSON.stringify({ error: `AM Out must be after AM In for Day ${day}` }), { 
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          shiftsToInsert.push({ start: amIn, end: amOut });
        } else {
          // Punch-in only
          shiftsToInsert.push({ start: amIn, end: amIn });
        }
      } else if (amOut) {
        return new Response(JSON.stringify({ error: `AM In must be set if AM Out is set for Day ${day}` }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }

      // Normal PM shift
      if (pmIn) {
        if (pmOut) {
          if (!validateShift(pmIn, pmOut)) {
            return new Response(JSON.stringify({ error: `PM Out must be after PM In for Day ${day}` }), { 
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }
          shiftsToInsert.push({ start: pmIn, end: pmOut });
        } else {
          // Punch-in only
          shiftsToInsert.push({ start: pmIn, end: pmIn });
        }
      } else if (pmOut) {
        return new Response(JSON.stringify({ error: `PM In must be set if PM Out is set for Day ${day}` }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 1. Delete existing manual entries for this date
    const startOfDay = new Date(`${dateStr}T00:00:00+08:00`).toISOString();
    const endOfDay = new Date(`${dateStr}T23:59:59.999+08:00`).toISOString();

    const { error: deleteError } = await supabase
      .from('entries')
      .delete()
      .eq('user_id', userId)
      .eq('is_employee', settings.isEmployee ?? false)
      .gte('start_time', startOfDay)
      .lte('start_time', endOfDay);

    if (deleteError) throw deleteError;

    // 2. Insert new shifts
    for (const shift of shiftsToInsert) {
      const sDate = new Date(`${dateStr}T${shift.start}:00+08:00`);
      const eDate = new Date(`${dateStr}T${shift.end}:00+08:00`);
      const durationSeconds = Math.floor((eDate.getTime() - sDate.getTime()) / 1000);

      const { error: insertError } = await supabase
        .from('entries')
        .insert({
          user_id: userId,
          description: 'General Work', // Automated description
          start_time: sDate.toISOString(),
          end_time: eDate.toISOString(),
          duration_seconds: durationSeconds,
          is_employee: settings.isEmployee ?? false
        });

      if (insertError) throw insertError;
    }

    // 3. Recalculate total monthly hours to send back
    const { getManualEntries } = await import('../../../lib/entries');
    const { getDailyDTR, getClockifyUser } = await import('../../../lib/clockify');
    const manual = await getManualEntries(userId, settings.isEmployee ?? false);
    
    const manualFiltered = manual.filter((e) => {
      const d = new Date(e.startFull || `${e.date}T${e.startTime}+08:00`);
      return d.getMonth() + 1 === month && d.getFullYear() === year;
    });

    let clockifyId = "";
    if (!!(import.meta.env.CLOCKIFY_API_KEY && import.meta.env.CLOCKIFY_WORKSPACE_ID) && settings.clockifyEnabled !== false) {
      try {
        const clockifyUser = await getClockifyUser(settings.userEmail || "");
        if (clockifyUser) clockifyId = clockifyUser.id;
      } catch (e) {}
    }

    const dtrResult = await getDailyDTR(clockifyId, month, year, manualFiltered);
    const dayResult = dtrResult.days.find(d => parseInt(d.day) === day);
    const totalMonthSeconds = dtrResult.totalMonthlyHours * 3600;

    // Add a sync log entry to track the change
    const { addSyncLog } = await import('../../../lib/logs');
    await addSyncLog({ 
      userId: session.id, 
      type: 'Mode', 
      status: 'Success', 
      details: `DTR direct edit on ${dateStr}: ${shiftsToInsert.length} shift(s) logged` 
    });

    return new Response(JSON.stringify({ 
      success: true,
      dayTotalSeconds: dayResult ? dayResult.totalSeconds : 0,
      totalMonthSeconds: totalMonthSeconds
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err: any) {
    console.error('Error saving DTR entry:', err);
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
