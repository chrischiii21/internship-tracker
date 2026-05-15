import { supabase } from './supabase';

export interface PayoutAdjustment {
  user_id: string;
  period_label: string;
  amount_received: number;
  updated_at?: string;
}

export async function getPayoutAdjustments(userId: string): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabase
      .from('payout_adjustments')
      .select('period_label, amount_received')
      .eq('user_id', userId);
    
    if (error) {
      console.error('Error fetching payout adjustments:', error);
      return {};
    }
    
    const adjustments: Record<string, number> = {};
    data.forEach(row => {
      adjustments[row.period_label] = row.amount_received;
    });
    return adjustments;
  } catch (e) {
    console.error('Payout fetch error:', e);
    return {};
  }
}

export async function savePayoutAdjustment(userId: string, periodLabel: string, amountReceived: number) {
  const { error } = await supabase
    .from('payout_adjustments')
    .upsert({
      user_id: userId,
      period_label: periodLabel,
      amount_received: amountReceived,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id,period_label'
    });
  
  if (error) throw error;
}
