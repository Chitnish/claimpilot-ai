-- Patient accounts-receivable columns on the claims table (additive migration).
--
-- After the payer adjudicates, the remaining patient responsibility (copay +
-- deductible + coinsurance) becomes a patient balance that the practice must
-- bill and collect. These columns make the A/R aging report queryable from the
-- flat claims work list. The same values also live in each claim's ClaimState
-- snapshot in Storage, so claim detail / statement download work before this
-- migration is applied; only the /ar/aging roll-up needs these columns.
--
-- Apply with:  .\.venv\Scripts\python.exe scripts\run_migrations.py
-- (requires SUPABASE_DB_URL in backend/.env). DO NOT auto-run in this repo.

alter table claims
    add column if not exists patient_responsibility  numeric(12, 2) default 0,
    add column if not exists patient_balance          numeric(12, 2) default 0,
    add column if not exists ar_status                text,
    add column if not exists statement_date           date;

-- The aging report filters on open patient balances.
create index if not exists claims_ar_status_idx on claims (ar_status);
