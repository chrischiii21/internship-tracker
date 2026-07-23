import type { APIRoute } from 'astro';
import { getSession } from '../../../lib/auth';
import { parse } from 'cookie';
import { getAppSettings } from '../../../lib/settings';
import { getManualEntries } from '../../../lib/entries';
import { getDailyDTR, getClockifyUser } from '../../../lib/clockify';
import { addSyncLog } from '../../../lib/logs';
import { saveOverride, clearOverride, getMonthlyAttendance, expandDateRange, getAttendanceConfig, getHolidays, partitionWorkingDates, type AttendanceStatus } from '../../../lib/attendance';

const VALID_STATUSES: AttendanceStatus[] = ['present', 'absent', 'wfh', 'sl', 'vl'];

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const session = cookies.session ? await getSession(cookies.session) : null;

  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { date, endDate, status, isHalfDay } = await request.json();

    if (!date || !status) {
      return new Response(JSON.stringify({ error: 'Missing required parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (status !== 'clear' && !VALID_STATUSES.includes(status)) {
      return new Response(JSON.stringify({ error: 'Invalid status' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const settings = await getAppSettings(session.id);

    if (settings.role === 'coordinator') {
      return new Response(JSON.stringify({ error: 'Coordinators cannot edit attendance' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const isEmployee = settings.isEmployee ?? false;

    // Bulk / range mode: apply the same status to every date in [date, endDate].
    if (endDate && endDate !== date) {
      let dates: string[];
      try {
        dates = expandDateRange(date, endDate);
      } catch (e: any) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      let datesToApply = dates;
      let skippedCount = 0;

      // Marking a status should never paint over days off — only clearing touches every date in
      // the range, since a leftover override on a now-non-working day is still fine to remove.
      if (status !== 'clear') {
        const [config, holidays] = await Promise.all([getAttendanceConfig(session.id), getHolidays(session.id)]);
        const { working, nonWorking } = partitionWorkingDates(dates, config, holidays);
        datesToApply = working;
        skippedCount = nonWorking.length;
      }

      for (const d of datesToApply) {
        if (status === 'clear') await clearOverride(session.id, isEmployee, d);
        else await saveOverride(session.id, isEmployee, d, status, !!isHalfDay);
      }

      await addSyncLog({
        userId: session.id,
        type: 'Settings',
        status: 'Success',
        details: `Attendance ${date} to ${endDate} marked ${status} (${datesToApply.length} day(s)${skippedCount ? `, ${skippedCount} non-working day(s) skipped` : ''})`,
      });

      return new Response(JSON.stringify({ success: true, bulk: true, count: datesToApply.length, skipped: skippedCount }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Single-day mode
    if (status === 'clear') {
      await clearOverride(session.id, isEmployee, date);
    } else {
      await saveOverride(session.id, isEmployee, date, status, !!isHalfDay);
    }

    // Recompute the day's effective status (needed for 'clear', which reverts to auto/calendar/unmarked)
    const [year, month, day] = date.split('-').map((n: string) => parseInt(n, 10));

    const manual = await getManualEntries(session.id, isEmployee);
    const manualFiltered = manual.filter((e) => {
      const d = new Date(e.startFull || `${e.date}T${e.startTime}+08:00`);
      return d.getMonth() + 1 === month && d.getFullYear() === year;
    });

    let clockifyId = '';
    if (!!(import.meta.env.CLOCKIFY_API_KEY && import.meta.env.CLOCKIFY_WORKSPACE_ID) && settings.clockifyEnabled !== false) {
      try {
        const clockifyUser = await getClockifyUser(settings.userEmail || '');
        if (clockifyUser) clockifyId = clockifyUser.id;
      } catch (e) {}
    }

    const dtrResult = await getDailyDTR(clockifyId, month, year, manualFiltered);
    const dailyTotals: Record<number, number> = {};
    for (const d of dtrResult.days) dailyTotals[parseInt(d.day)] = d.totalSeconds;

    const { days } = await getMonthlyAttendance(session.id, isEmployee, month, year, dailyTotals);
    const dayResult = days.find((d) => d.day === day);

    await addSyncLog({
      userId: session.id,
      type: 'Settings',
      status: 'Success',
      details: `Attendance ${date} marked ${status}`,
    });

    return new Response(JSON.stringify({ success: true, day: dayResult }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('Error saving attendance status:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
