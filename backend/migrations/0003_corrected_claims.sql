-- Corrected-claim resubmission lineage on the claims table (additive migration).
--
-- Supports filing a corrected claim (837P CLM05-3 frequency type code 7 =
-- replacement, 8 = void) that references the original payer claim control number
-- instead of re-filing a brand-new claim (which would trip the duplicate edit,
-- CARC 18). The full lineage also lives in each claim's ClaimState snapshot in
-- Storage, so the feature works even before this migration is applied — these
-- columns make the lineage queryable from the flat claims work list.
--
-- Apply with:  .\.venv\Scripts\python.exe scripts\run_migrations.py
-- (requires SUPABASE_DB_URL in backend/.env). DO NOT auto-run in this repo.

alter table claims
    add column if not exists frequency_code        text default '1',
    add column if not exists original_claim_id      uuid,
    add column if not exists correction_count       integer not null default 0,
    add column if not exists corrected_by_claim_id  uuid;

-- Fast lookups of a correction's parent and of a parent's replacement.
create index if not exists claims_original_claim_idx
    on claims (original_claim_id);
create index if not exists claims_corrected_by_idx
    on claims (corrected_by_claim_id);
