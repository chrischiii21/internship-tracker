import { supabase } from './supabase';

export interface AppSettings {
  startDate: string;
  targetHours: number;
  hourlyRate: number;
  setupComplete: boolean;
  program: string;
  hostCompany: string;
  supervisor: string;
  supervisorPosition: string;
  hasAllowance: boolean;
  payType: 'hourly' | 'daily';
  paySchedule: 'weekly' | 'semi-monthly' | 'monthly';
  role: 'student' | 'coordinator';
  inviteCode?: string;
  coordinatorId?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
  userName?: string;
  userEmail?: string;
  userPicture?: string;
  clockifyEnabled: boolean;
  isEmployee?: boolean;
  monthlyRate?: number;
  employeeStartDate?: string;
  employerCompany?: string;
  employeePaySchedule?: 'semi-monthly' | 'monthly';
}

export const DEFAULT_SETTINGS: AppSettings = {
  startDate: '2024-01-01',
  targetHours: 480,
  hourlyRate: 60,
  setupComplete: false,
  program: '',
  hostCompany: '',
  supervisor: '',
  supervisorPosition: '',
  hasAllowance: true,
  payType: 'hourly',
  paySchedule: 'monthly',
  role: 'student',
  clockifyEnabled: true,
  isEmployee: false,
  monthlyRate: 0,
  employeeStartDate: '',
  employerCompany: '',
  employeePaySchedule: 'monthly'
};

export async function getAppSettings(userId: string): Promise<AppSettings> {
  // Check Coordinator table first
  const { data: coordData } = await supabase
    .from('coordinator_settings')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (coordData) {
    return {
      ...DEFAULT_SETTINGS,
      role: 'coordinator',
      inviteCode: coordData.invite_code,
      userName: coordData.user_name,
      userEmail: coordData.user_email,
      userPicture: coordData.user_picture,
      setupComplete: true
    };
  }

  // Check Student table
  const { data: studentData } = await supabase
    .from('student_settings')
    .select('*, coordinator_sections(section_name)')
    .eq('user_id', userId)
    .single();

  if (studentData) {
    return {
      startDate: studentData.start_date,
      targetHours: studentData.target_hours,
      hourlyRate: studentData.hourly_rate,
      setupComplete: studentData.setup_complete,
      program: studentData.program,
      hostCompany: studentData.host_company,
      supervisor: studentData.supervisor,
      supervisorPosition: studentData.supervisor_position,
      hasAllowance: studentData.has_allowance,
      payType: studentData.pay_type,
      paySchedule: studentData.pay_schedule,
      role: 'student',
      coordinatorId: studentData.coordinator_id,
      sectionId: studentData.section_id,
      sectionName: studentData.coordinator_sections?.section_name || null,
      userName: studentData.user_name,
      userEmail: studentData.user_email,
      userPicture: studentData.user_picture,
      clockifyEnabled: studentData.clockify_enabled ?? true,
      isEmployee: studentData.is_employee ?? false,
      monthlyRate: studentData.monthly_rate ?? 0,
      employeeStartDate: studentData.employee_start_date,
      employerCompany: studentData.employer_company,
      employeePaySchedule: studentData.employee_pay_schedule ?? 'monthly'
    };
  }

  return { ...DEFAULT_SETTINGS };
}

export async function saveAppSettings(userId: string, updated: Partial<AppSettings>) {
  if (updated.role === 'coordinator') {
    // Delete from student table if they switched (unlikely but safe)
    await supabase.from('student_settings').delete().eq('user_id', userId);

    const { error } = await supabase
      .from('coordinator_settings')
      .upsert({
        user_id: userId,
        user_name: updated.userName,
        user_email: updated.userEmail,
        user_picture: updated.userPicture,
        invite_code: updated.inviteCode,
        updated_at: new Date().toISOString()
      });
    if (error) throw new Error(error.message);
  } else {
    // Delete from coordinator table if they switched
    await supabase.from('coordinator_settings').delete().eq('user_id', userId);

    const { error } = await supabase
      .from('student_settings')
      .upsert({
        user_id: userId,
        user_name: updated.userName,
        user_email: updated.userEmail,
        user_picture: updated.userPicture,
        coordinator_id: updated.coordinatorId,
        section_id: updated.sectionId,
        start_date: updated.startDate || DEFAULT_SETTINGS.startDate,
        target_hours: updated.targetHours || DEFAULT_SETTINGS.targetHours,
        hourly_rate: updated.hourlyRate || DEFAULT_SETTINGS.hourlyRate,
        setup_complete: updated.setupComplete ?? DEFAULT_SETTINGS.setupComplete,
        program: updated.program,
        host_company: updated.hostCompany,
        supervisor: updated.supervisor,
        supervisor_position: updated.supervisorPosition,
        has_allowance: updated.hasAllowance ?? DEFAULT_SETTINGS.hasAllowance,
        pay_type: updated.payType || DEFAULT_SETTINGS.payType,
        pay_schedule: updated.paySchedule || DEFAULT_SETTINGS.paySchedule,
        clockify_enabled: updated.clockifyEnabled ?? DEFAULT_SETTINGS.clockifyEnabled,
        is_employee: updated.isEmployee ?? DEFAULT_SETTINGS.isEmployee,
        monthly_rate: updated.monthlyRate ?? DEFAULT_SETTINGS.monthlyRate,
        employee_start_date: updated.employeeStartDate,
        employer_company: updated.employerCompany,
        employee_pay_schedule: updated.employeePaySchedule,
        updated_at: new Date().toISOString()
      });
    if (error) throw new Error(error.message);
  }
}
