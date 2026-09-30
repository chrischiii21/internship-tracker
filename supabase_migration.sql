-- ==========================================================================
-- InternFlow — database migration
-- Run in the Supabase SQL editor. Written against the live schema as it stood
-- on 2026-09-06; every statement is safe to re-run.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. active_timers: key by (user_id, is_employee)
-- --------------------------------------------------------------------------
-- The table is keyed by user_id alone, but the app upserts a timer per tracking mode
-- (is_employee), exactly like `entries` and `attendance_overrides`. As it stands, starting a timer
-- in one mode overwrites a timer still running in the other.
-- No rows are lost: this only widens the key.

ALTER TABLE public.active_timers
  ADD COLUMN IF NOT EXISTS is_employee BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.active_timers DROP CONSTRAINT IF EXISTS active_timers_pkey;
ALTER TABLE public.active_timers ADD PRIMARY KEY (user_id, is_employee);


-- --------------------------------------------------------------------------
-- 1b. attendance_overrides: a reason for the day  (REQUIRED for the new feature)
-- --------------------------------------------------------------------------
-- Marking a day Absent / SL / VL / WFH can now carry a short note explaining why, shown on the
-- calendar cell and on the DTR row. Without this column those saves fail.

ALTER TABLE public.attendance_overrides ADD COLUMN IF NOT EXISTS reason TEXT;


-- --------------------------------------------------------------------------
-- 1c. salary_history  (REQUIRED for the salary history feature)
-- --------------------------------------------------------------------------
-- Records each monthly rate an employee has had, so Settings can show raises over time and the
-- payouts breakdown prices each period at the rate in force back then. Until this runs, the app
-- reads an empty history and keeps working exactly as before. The UNIQUE key doubles as the
-- lookup index (user_id, effective_date).

CREATE TABLE IF NOT EXISTS public.salary_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    monthly_rate NUMERIC NOT NULL,
    effective_date DATE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (user_id, effective_date)
);
ALTER TABLE public.salary_history ENABLE ROW LEVEL SECURITY;


-- --------------------------------------------------------------------------
-- 2. Indexes for the queries the app actually runs
-- --------------------------------------------------------------------------
-- Hours are always read as "this user, this mode, since this date"; the coordinator roster reads
-- students by section; sync logs are read newest-first per user.

CREATE INDEX IF NOT EXISTS idx_entries_user_mode_start ON public.entries(user_id, is_employee, start_time);
CREATE INDEX IF NOT EXISTS idx_student_section ON public.student_settings(section_id);
CREATE INDEX IF NOT EXISTS idx_sections_coordinator ON public.coordinator_sections(coordinator_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_user ON public.sync_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_user ON public.payout_adjustments(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.sessions(expires_at);


-- --------------------------------------------------------------------------
-- 3. Prune expired sessions
-- --------------------------------------------------------------------------
-- Sessions are only deleted when someone logs out, so expired rows pile up
-- (61 of 113 rows were already dead). Logged-in users are unaffected — an expired
-- row can no longer authenticate anyone.

DELETE FROM public.sessions WHERE expires_at < NOW();


-- --------------------------------------------------------------------------
-- 4. Orphaned sync logs  (REVIEW FIRST)
-- --------------------------------------------------------------------------
-- 18 user_ids in sync_logs no longer have an account — left behind by account deletions before
-- deleteAccount() was taught to clean this table. Look before you delete:
--
--   SELECT user_id, count(*), min(created_at), max(created_at)
--     FROM public.sync_logs
--    WHERE user_id NOT IN (SELECT user_id FROM public.student_settings)
--      AND user_id NOT IN (SELECT user_id FROM public.coordinator_settings)
--    GROUP BY user_id ORDER BY count DESC;
--
-- Then, if you're happy to lose them:
--
-- DELETE FROM public.sync_logs
--  WHERE user_id NOT IN (SELECT user_id FROM public.student_settings)
--    AND user_id NOT IN (SELECT user_id FROM public.coordinator_settings);


-- --------------------------------------------------------------------------
-- 5. student_settings.rendered_hours  (OPTIONAL — check for a trigger first)
-- --------------------------------------------------------------------------
-- This column is a denormalised copy of SUM(entries.duration_seconds). It matched the entries
-- total to the cent for all 19 students that had a value, and no application code writes it —
-- something in the database keeps it current. The app now sums `entries` directly, so nothing
-- reads the column any more.
--
-- Leaving it costs nothing. If you want the redundancy gone, find the writer FIRST — dropping a
-- column that a trigger writes to breaks every insert into `entries`:
--
--   SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid)
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE NOT t.tgisinternal AND c.relname IN ('entries', 'student_settings');
--
-- Only after dropping or amending that trigger:
--
-- ALTER TABLE public.student_settings DROP COLUMN IF EXISTS rendered_hours;


-- --------------------------------------------------------------------------
-- 6. Stale running timers  (REVIEW — the app now handles these safely)
-- --------------------------------------------------------------------------
-- 12 timers were still running, the oldest since June. stopTimer() now caps any session over 24h
-- to one shift's length rather than banking the whole gap, so these are no longer dangerous — the
-- owner just gets one shift logged on the day they clocked in, with a message to correct it.
-- To see them:
--
--   SELECT user_id, is_employee, start_time, NOW() - start_time AS running_for
--     FROM public.active_timers ORDER BY start_time;
--
-- To clear a specific abandoned one without logging any hours:
--
-- DELETE FROM public.active_timers WHERE user_id = '<google id>' AND is_employee = <true|false>;
