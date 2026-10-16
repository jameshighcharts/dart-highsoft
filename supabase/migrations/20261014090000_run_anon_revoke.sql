-- Merge only once production is verified to use per-member tokens: Supabase requests from the
-- browser carry `Authorization: Bearer <token>` (not the anon key) and succeed, and live scores
-- update. Then the anon key in the public pages' JavaScript opens nothing (see
-- 20261013150000_prepare_anon_revoke.sql).
select public.revoke_anon_access();
