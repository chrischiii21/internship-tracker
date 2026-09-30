import { getSession } from '../../lib/auth';
import { getPayoutAdjustments, savePayoutAdjustment } from '../../lib/payouts';
import { getAppSettings } from '../../lib/settings';
import { getTrackedEntries } from '../../lib/entries';
import { groupEntries } from '../../lib/grouping';
import { activePaySchedule, buildPeriodBreakdown } from '../../lib/earnings';
import { getSalaryHistory } from '../../lib/salary';
import { parse } from 'cookie';

// Recomputed breakdown for the Dashboard's earnings modal. Marking one period as received shifts
// the carry-over into every later period, so the rows are rebuilt here rather than patched in the
// browser — one implementation of the money math, server side.
export async function GET({ request }: { request: Request }) {
  const cookies = parse(request.headers.get('cookie') || '');
  const user = cookies.session ? await getSession(cookies.session) : null;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const settings = await getAppSettings(user.id);
  const isEarningsMode = !!(settings.hasAllowance || settings.isEmployee);
  const startDate = settings.isEmployee ? (settings.employeeStartDate || settings.startDate) : settings.startDate;

  const entries = await getTrackedEntries(user.id, user.email, settings, startDate);
  const groups = groupEntries(entries, isEarningsMode ? activePaySchedule(settings) : 'monthly');
  const adjustments = isEarningsMode ? await getPayoutAdjustments(user.id) : {};
  const salaryHistory = settings.isEmployee ? await getSalaryHistory(user.id) : [];

  return new Response(JSON.stringify({
    isEarningsMode,
    payType: settings.payType,
    isEmployee: !!settings.isEmployee,
    rows: buildPeriodBreakdown(settings, groups, adjustments, salaryHistory),
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }: { request: Request }) {
  const cookieHeader = request.headers.get('cookie') || '';
  const cookies = parse(cookieHeader);
  const user = cookies.session ? await getSession(cookies.session) : null;

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const { periodLabel, amountReceived } = await request.json();
    const amount = Number(amountReceived);

    if (!periodLabel || !Number.isFinite(amount)) {
      return new Response(JSON.stringify({ error: 'Invalid data' }), { status: 400 });
    }

    await savePayoutAdjustment(user.id, periodLabel, amount);

    // The breakdown lives in a modal on the Dashboard, so the caller updates in place rather
    // than following a redirect that would close it.
    return new Response(JSON.stringify({ success: true, periodLabel, amountReceived: amount }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Payout API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
