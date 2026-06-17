-- Attributable, append-only audit trail for compliance (additive migration).
--
-- Records WHO did WHAT to WHICH claim: review approve/reject decisions,
-- approval denials (insufficient authority), CMS-1500 PDF downloads (PHI
-- access), and Review Copilot access (PHI access). The backend writes here
-- best-effort via app.services.supabase_client.log_audit_event; until this
-- table exists, those writes simply no-op, so applying this migration is safe
-- and non-breaking.
--
-- Apply with:  .\.venv\Scripts\python.exe scripts\run_migrations.py
-- (requires SUPABASE_DB_URL in backend/.env). DO NOT auto-run in this repo.

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
