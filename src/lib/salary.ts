import { supabase } from './supabase';

export interface SalaryChange {
  id: string;
  monthlyRate: number;
  effectiveDate: string; // YYYY-MM-DD
}

// Oldest first. A missing table (migration not run yet) reads as no history, never a broken page.
export async function getSalaryHistory(userId: string): Promise<SalaryChange[]> {
  const { data, error } = await supabase
    .from('salary_history')
    .select('id, monthly_rate, effective_date')
    .eq('user_id', userId)
    .order('effective_date');

  if (error) {
    console.error('Error fetching salary history:', error);
    return [];
  }
  return data.map(row => ({ id: row.id, monthlyRate: Number(row.monthly_rate), effectiveDate: row.effective_date }));
}

// Called when an employee saves a different monthly rate. The first change also records the rate it
// replaced (from the employment start date), so the very first raise has something to measure
// against. One row per effective date: re-saving the same date corrects it instead of stacking.
export async function recordSalaryChange(
  userId: string,
  oldRate: number,
  newRate: number,
  effectiveDate: string,
  startDate: string,
) {
  const history = await getSalaryHistory(userId);
  const rows = new Map<string, number>();
  if (!history.length && startDate) rows.set(startDate, oldRate || newRate);
  if (history.length || oldRate > 0) rows.set(effectiveDate, newRate);
  if (!rows.size) return;

  const { error } = await supabase
    .from('salary_history')
    .upsert(
      [...rows].map(([effective_date, monthly_rate]) => ({ user_id: userId, effective_date, monthly_rate })),
      { onConflict: 'user_id,effective_date' },
    );
  if (error) throw error;
}

export async function deleteSalaryChange(userId: string, id: string) {
  const { error } = await supabase.from('salary_history').delete().eq('user_id', userId).eq('id', id);
  if (error) throw error;
}
