-- =============================================================================
-- ClaimPilot AI — combined migrations (apply once in Supabase SQL Editor)
-- Order: 0001 → 0002 → 0003 → 0004
-- All statements are idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
-- =============================================================================


-- =============================================================================
-- MIGRATION 0001_claim_states.sql
-- Durable storage for the full pipeline ClaimState.
-- =============================================================================

-- Durable storage for the full pipeline ClaimState (additive migration).
-- The claims table keeps its flat reporting columns; this table holds the
-- complete typed state so the API survives backend restarts.

create table if not exists claim_states (
    claim_id   uuid primary key,
    org_id     uuid,
    status     text not null default 'draft',
    state      jsonb not null,
    updated_at timestamptz not null default now()
);

create index if not exists claim_states_org_idx on claim_states (org_id);
create index if not exists claim_states_status_idx on claim_states (status);

alter table claim_states enable row level security;


-- =============================================================================
-- MIGRATION 0002_audit_log.sql
-- Attributable, append-only audit trail for compliance.
-- =============================================================================

-- Attributable, append-only audit trail for compliance (additive migration).
--
-- Records WHO did WHAT to WHICH claim: review approve/reject decisions,
-- approval denials (insufficient authority), CMS-1500 PDF downloads (PHI
-- access), and Review Copilot access (PHI access). The backend writes here
-- best-effort via app.services.supabase_client.log_audit_event; until this
-- table exists, those writes simply no-op, so applying this migration is safe
-- and non-breaking.

create table if not exists audit_log (
    id          uuid primary key default gen_random_uuid(),
    claim_id    uuid,
    org_id      uuid,
    actor_id    text not null default 'anonymous',
    actor_name  text not null default 'Unknown User',
    actor_role  text not null default 'unknown',
    action      text not null,            -- approve_claim | reject_claim | approve_denied | download_cms1500 | view_copilot
    detail      text not null default '',
    metadata    jsonb not null default '{}'::jsonb,
    created_at  timestamptz not null default now()
);

create index if not exists audit_log_claim_idx on audit_log (claim_id);
create index if not exists audit_log_org_idx on audit_log (org_id);
create index if not exists audit_log_actor_idx on audit_log (actor_id);
create index if not exists audit_log_created_idx on audit_log (created_at desc);

-- Immutability: audit rows are insert-only. Block updates and deletes at the
-- table level (the service role bypasses RLS, so enforce via triggers).
create or replace function audit_log_block_mutation()
returns trigger language plpgsql as $$
begin
    raise exception 'audit_log is append-only; % is not permitted', tg_op;
end;
$$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update on audit_log
    for each row execute function audit_log_block_mutation();

drop trigger if exists audit_log_no_delete on audit_log;
create trigger audit_log_no_delete before delete on audit_log
    for each row execute function audit_log_block_mutation();

alter table audit_log enable row level security;


-- =============================================================================
-- MIGRATION 0003_corrected_claims.sql
-- Corrected-claim resubmission lineage on the claims table.
-- =============================================================================

-- Corrected-claim resubmission lineage on the claims table (additive migration).
--
-- Supports filing a corrected claim (837P CLM05-3 frequency type code 7 =
-- replacement, 8 = void) that references the original payer claim control number
-- instead of re-filing a brand-new claim (which would trip the duplicate edit,
-- CARC 18). The full lineage also lives in each claim's ClaimState snapshot in
-- Storage; these columns make the lineage queryable from the flat claims work list.

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


-- =============================================================================
-- MIGRATION 0004_patient_ar.sql
-- Patient accounts-receivable columns on the claims table.
-- =============================================================================

-- Patient accounts-receivable columns on the claims table (additive migration).
--
-- After the payer adjudicates, the remaining patient responsibility (copay +
-- deductible + coinsurance) becomes a patient balance that the practice must
-- bill and collect. These columns make the A/R aging report queryable from the
-- flat claims work list.

alter table claims
    add column if not exists patient_responsibility  numeric(12, 2) default 0,
    add column if not exists patient_balance          numeric(12, 2) default 0,
    add column if not exists ar_status                text,
    add column if not exists statement_date           date;

-- The aging report filters on open patient balances.
create index if not exists claims_ar_status_idx on claims (ar_status);
