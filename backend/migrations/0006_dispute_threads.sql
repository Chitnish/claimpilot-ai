create table if not exists dispute_threads (
    id              uuid primary key default gen_random_uuid(),
    claim_id        uuid not null,
    org_id          uuid,
    sender          text not null,        -- 'reviewer_initial' | 'payer_reply' | 'ai_reply'
    message_text    text not null,
    resend_email_id text,
    created_at      timestamptz not null default now()
);
create index if not exists dispute_threads_claim_idx on dispute_threads (claim_id);
create index if not exists dispute_threads_created_idx on dispute_threads (created_at);

alter table claims
    add column if not exists has_pending_dispute boolean default false;
