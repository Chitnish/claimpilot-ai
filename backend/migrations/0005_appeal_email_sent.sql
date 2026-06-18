-- Track whether the appeal letter email was manually sent to the payer.
--
-- Appeal letters are still drafted automatically on denial/rejection, but sending
-- is now a deliberate reviewer action from the claim detail page. This column
-- lets the UI show draft vs sent status without re-reading Resend logs.
--
-- Apply with:  .\.venv\Scripts\python.exe scripts\run_migrations.py
-- (requires SUPABASE_DB_URL in backend/.env). DO NOT auto-run in this repo.

alter table claims
    add column if not exists appeal_email_sent boolean default false;
