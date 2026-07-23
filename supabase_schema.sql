-- ==========================================
-- UNIFIED OJT SYSTEM SCHEMA (PRODUCTION)
-- ==========================================

-- 1. COORDINATOR SETTINGS
-- Purpose: Stores profiles and invite codes for coordinators.
CREATE TABLE IF NOT EXISTS public.coordinator_settings (
    user_id TEXT PRIMARY KEY, -- Google ID string
    user_name TEXT,
    user_email TEXT,
    user_picture TEXT,
    invite_code TEXT UNIQUE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. STUDENT SETTINGS
-- Purpose: Stores profiles and OJT program configuration for students.
CREATE TABLE IF NOT EXISTS public.student_settings (
    user_id TEXT PRIMARY KEY, -- Google ID string
    user_name TEXT,
    user_email TEXT,
    user_picture TEXT,
    
    coordinator_id TEXT REFERENCES public.coordinator_settings(user_id) ON DELETE SET NULL,
    
    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    target_hours NUMERIC NOT NULL DEFAULT 480 CHECK (target_hours > 0),
    hourly_rate NUMERIC NOT NULL DEFAULT 60 CHECK (hourly_rate >= 0),
    setup_complete BOOLEAN NOT NULL DEFAULT FALSE,
    
    program TEXT,
    host_company TEXT,
    supervisor TEXT,
    supervisor_position TEXT,
    
    has_allowance BOOLEAN NOT NULL DEFAULT TRUE,
    pay_type TEXT DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'daily')),
    pay_schedule TEXT DEFAULT 'monthly' CHECK (pay_schedule IN ('weekly', 'semi-monthly', 'monthly')),
    
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    monthly_rate NUMERIC DEFAULT 0,
    employee_start_date DATE,
    employer_company TEXT,
    employee_pay_schedule TEXT DEFAULT 'monthly',
    
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. ENTRIES TABLE
-- Purpose: Stores completed internship time logs.
CREATE TABLE IF NOT EXISTS public.entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, -- Google ID string
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. ACTIVE TIMERS TABLE
-- Purpose: Stores currently running timer sessions.
CREATE TABLE IF NOT EXISTS public.active_timers (
    user_id TEXT PRIMARY KEY, -- Google ID string
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. SESSIONS TABLE (For OAuth Session Management)
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_data JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 6. INDEXES for Performance
CREATE INDEX IF NOT EXISTS idx_student_coordinator ON public.student_settings(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_entries_user ON public.entries(user_id);
CREATE INDEX IF NOT EXISTS idx_timers_user ON public.active_timers(user_id);

-- 7. ROW LEVEL SECURITY (RLS)
ALTER TABLE public.coordinator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- 8. POLICIES
-- NOTE: Policies here are simplified for documentation. 
-- In production, they ensure users manage their own data and coordinators can see their students.

CREATE POLICY "Users can manage own coordinator settings" ON public.coordinator_settings FOR ALL USING (true); -- Simplified
CREATE POLICY "Users can manage own student settings" ON public.student_settings FOR ALL USING (true); -- Simplified
CREATE POLICY "Users can manage own entries" ON public.entries FOR ALL USING (true); -- Simplified
CREATE POLICY "Users can manage own timers" ON public.active_timers FOR ALL USING (true); -- Simplified
CREATE POLICY "Session management" ON public.sessions FOR ALL USING (true); -- Simplified

-- ==========================================
-- ATTENDANCE FEATURE
-- ==========================================

-- 9. ATTENDANCE OVERRIDES
-- Purpose: Manual per-day status marks (present/absent/wfh/sl/vl), partitioned by mode like `entries`.
-- NOTE: if this table was already created before SL/VL replaced the single generic 'leave' status,
-- run this migration first (defaults any existing 'leave' rows to 'vl'):
--   UPDATE public.attendance_overrides SET status = 'vl' WHERE status = 'leave';
--   ALTER TABLE public.attendance_overrides DROP CONSTRAINT attendance_overrides_status_check;
--   ALTER TABLE public.attendance_overrides ADD CONSTRAINT attendance_overrides_status_check CHECK (status IN ('present', 'absent', 'wfh', 'sl', 'vl'));
CREATE TABLE IF NOT EXISTS public.attendance_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'wfh', 'sl', 'vl')),
    is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, is_employee, date)
);

-- 10. ATTENDANCE CONFIG
-- Purpose: Non-working weekdays + full-day-hours threshold. Shared across modes (user_id only).
CREATE TABLE IF NOT EXISTS public.attendance_config (
    user_id TEXT PRIMARY KEY,
    non_working_weekdays INTEGER[] NOT NULL DEFAULT '{0,6}', -- 0=Sun..6=Sat
    full_day_hours NUMERIC NOT NULL DEFAULT 8 CHECK (full_day_hours > 0),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 11. ATTENDANCE HOLIDAYS
-- Purpose: Specific dates forced to non-working. Shared across modes (user_id only).
CREATE TABLE IF NOT EXISTS public.attendance_holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    date DATE NOT NULL,
    label TEXT NOT NULL DEFAULT 'Holiday',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_overrides_user ON public.attendance_overrides(user_id, is_employee);
CREATE INDEX IF NOT EXISTS idx_attendance_holidays_user ON public.attendance_holidays(user_id);

ALTER TABLE public.attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_holidays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own attendance overrides" ON public.attendance_overrides FOR ALL USING (true); -- Simplified
CREATE POLICY "Users can manage own attendance config" ON public.attendance_config FOR ALL USING (true); -- Simplified
CREATE POLICY "Users can manage own attendance holidays" ON public.attendance_holidays FOR ALL USING (true); -- Simplified
