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
