-- ==========================================
-- UNIFIED OJT SYSTEM SCHEMA (PRODUCTION)
-- ==========================================
-- Tables are declared in dependency order. Everything the app touches is here — see the
-- MIGRATIONS section at the bottom for bringing an existing database up to this definition.

-- 1. COORDINATOR SETTINGS
-- Purpose: Stores profiles and invite codes for coordinators.
CREATE TABLE IF NOT EXISTS public.coordinator_settings (
    user_id TEXT PRIMARY KEY, -- Google ID string
    user_name TEXT,
    user_email TEXT,
    user_picture TEXT,
    invite_code TEXT UNIQUE, -- personal fallback code; per-section codes live on coordinator_sections
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. COORDINATOR SECTIONS
-- Purpose: Named groups of students under a coordinator, each with its own invite code. This is
-- the code students normally enter in Settings to join a roster.
CREATE TABLE IF NOT EXISTS public.coordinator_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coordinator_id TEXT NOT NULL REFERENCES public.coordinator_settings(user_id) ON DELETE CASCADE,
    section_name TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. STUDENT SETTINGS
-- Purpose: Stores profiles and OJT program configuration for students.
CREATE TABLE IF NOT EXISTS public.student_settings (
    user_id TEXT PRIMARY KEY, -- Google ID string
    user_name TEXT,
    user_email TEXT,
    user_picture TEXT,

    coordinator_id TEXT REFERENCES public.coordinator_settings(user_id) ON DELETE SET NULL,
    section_id UUID REFERENCES public.coordinator_sections(id) ON DELETE SET NULL,

    start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    target_hours NUMERIC NOT NULL DEFAULT 480 CHECK (target_hours > 0),
    hourly_rate NUMERIC NOT NULL DEFAULT 60 CHECK (hourly_rate >= 0), -- per hour, or per day when pay_type = 'daily'
    setup_complete BOOLEAN NOT NULL DEFAULT FALSE,

    program TEXT,
    host_company TEXT,
    supervisor TEXT,
    supervisor_position TEXT,

    has_allowance BOOLEAN NOT NULL DEFAULT TRUE,
    pay_type TEXT DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'daily')),
    pay_schedule TEXT DEFAULT 'monthly' CHECK (pay_schedule IN ('weekly', 'semi-monthly', 'monthly')),

    clockify_enabled BOOLEAN NOT NULL DEFAULT TRUE,

    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    monthly_rate NUMERIC DEFAULT 0,
    employee_start_date DATE,
    employer_company TEXT,
    employee_pay_schedule TEXT DEFAULT 'monthly' CHECK (employee_pay_schedule IN ('semi-monthly', 'monthly')),

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. ENTRIES TABLE
-- Purpose: Completed time logs — manual entries and finished Time In/Out sessions alike. This is
-- the single source of truth for hours logged in this system; Clockify hours are fetched live and
-- are never copied in here.
CREATE TABLE IF NOT EXISTS public.entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL, -- Google ID string
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
    documentation_urls TEXT[] NOT NULL DEFAULT '{}', -- uploaded proof images
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. ACTIVE TIMERS TABLE
-- Purpose: Currently running timer sessions. Keyed by (user_id, is_employee) like `entries` and
-- `attendance_overrides`, so switching tracking modes cannot clobber a running timer.
CREATE TABLE IF NOT EXISTS public.active_timers (
    user_id TEXT NOT NULL, -- Google ID string
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    description TEXT,
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    PRIMARY KEY (user_id, is_employee)
);

-- 6. SESSIONS TABLE (For OAuth Session Management)
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_data JSONB NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. SYNC LOGS
-- Purpose: Audit trail of clock actions and syncs, shown on the Sync Logs page.
CREATE TABLE IF NOT EXISTS public.sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('Sync', 'Auth', 'Mode', 'Settings')),
    status TEXT NOT NULL CHECK (status IN ('Success', 'Error', 'Warning')),
    details TEXT,
    duration TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 8. PAYOUT ADJUSTMENTS
-- Purpose: The amount actually received for a pay period, when it differs from what was expected.
-- period_label matches the label produced by src/lib/grouping.ts (e.g. "September 2026").
CREATE TABLE IF NOT EXISTS public.payout_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    period_label TEXT NOT NULL,
    amount_received NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, period_label)
);

-- 9. SALARY HISTORY
-- Purpose: Every monthly rate an employee has had, keyed by the date it took effect. Written when
-- Settings saves a different rate; pay periods are priced at the rate in force at the time.
CREATE TABLE IF NOT EXISTS public.salary_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    monthly_rate NUMERIC NOT NULL,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, effective_date)
);

-- ==========================================
-- ATTENDANCE FEATURE
-- ==========================================

-- 9. ATTENDANCE OVERRIDES
-- Purpose: Manual per-day status marks (present/absent/wfh/sl/vl), partitioned by mode like `entries`.
CREATE TABLE IF NOT EXISTS public.attendance_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    is_employee BOOLEAN NOT NULL DEFAULT FALSE,
    date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'wfh', 'sl', 'vl')),
    is_half_day BOOLEAN NOT NULL DEFAULT FALSE,
    reason TEXT, -- why the day was marked this way; shown on the calendar and the DTR
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

-- ==========================================
-- SHIFT / WORK SCHEDULE FEATURE
-- ==========================================

-- 12. SHIFT CONFIG
-- Purpose: The person's work schedule (day/mid-day/mid-night/night/custom). Shared across
-- is_employee modes (user_id only), same as attendance_config — a person has one schedule
-- regardless of tracking mode. Drives how the DTR labels/buckets punch times instead of assuming
-- a fixed 8-5 AM/PM day shift.
--   day       — starts morning, ends evening
--   mid-day   — starts midday, ends at night
--   mid-night — starts at dawn, ends in the afternoon
--   night     — starts at night, ends sometime during the day (crosses midnight)
CREATE TABLE IF NOT EXISTS public.shift_config (
    user_id TEXT PRIMARY KEY,
    shift_type TEXT NOT NULL DEFAULT 'day' CHECK (shift_type IN ('day', 'mid-day', 'mid-night', 'night', 'custom')),
    shift_start TIME NOT NULL DEFAULT '08:00',
    shift_end TIME NOT NULL DEFAULT '17:00',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ==========================================
-- INDEXES
-- ==========================================
CREATE INDEX IF NOT EXISTS idx_student_coordinator ON public.student_settings(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_student_section ON public.student_settings(section_id);
CREATE INDEX IF NOT EXISTS idx_sections_coordinator ON public.coordinator_sections(coordinator_id);
-- Every hours query filters on (user_id, is_employee) and ranges over start_time.
CREATE INDEX IF NOT EXISTS idx_entries_user_mode_start ON public.entries(user_id, is_employee, start_time);
CREATE INDEX IF NOT EXISTS idx_attendance_overrides_user ON public.attendance_overrides(user_id, is_employee);
CREATE INDEX IF NOT EXISTS idx_attendance_holidays_user ON public.attendance_holidays(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON public.sync_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_user ON public.payout_adjustments(user_id);
-- Supports pruning expired sessions.
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.sessions(expires_at);

-- ==========================================
-- ROW LEVEL SECURITY
-- ==========================================
-- The app connects with the service-role key, which bypasses RLS; these policies exist so nothing
-- is reachable if an anon key is ever used against the project.
ALTER TABLE public.coordinator_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coordinator_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.salary_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_config ENABLE ROW LEVEL SECURITY;

-- ==========================================
-- MIGRATING AN EXISTING DATABASE
-- ==========================================
-- This file defines the target state. To bring a database created from an earlier revision up to
-- it, run supabase_migration.sql — it carries only the statements that change something, with
-- notes on the two steps that want a look before you run them.
--
-- Value migrations kept from earlier revisions (no-ops if already applied):
UPDATE public.attendance_overrides SET status = 'vl' WHERE status = 'leave';
UPDATE public.shift_config SET shift_type = 'mid-day' WHERE shift_type = 'mid';

-- One column is deliberately absent from the definitions above: student_settings.rendered_hours,
-- a denormalised copy of SUM(entries.duration_seconds) that the app no longer reads. See section 5
-- of supabase_migration.sql before dropping it — a database trigger appears to maintain it.
