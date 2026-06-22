-- Patient Profile module: extended demographics, documents, appointments.
-- Run manually in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS).

-- Extend the existing patients table with full profile fields
alter table patients
    add column if not exists middle_name        text,
    add column if not exists preferred_name     text,
    add column if not exists gender             text,
    add column if not exists ssn_last4          text,   -- last 4 digits only, never full SSN
    add column if not exists address_line1      text,
    add column if not exists address_line2      text,
    add column if not exists city               text,
    add column if not exists state              text,
    add column if not exists zip_code           text,
    add column if not exists phone_primary      text,
    add column if not exists phone_secondary    text,
    add column if not exists email              text,
    add column if not exists emergency_contact_name         text,
    add column if not exists emergency_contact_relationship text,
    add column if not exists emergency_contact_phone        text,
    add column if not exists responsible_party_name         text,
    add column if not exists responsible_party_relationship text,  -- self | spouse | parent | guardian | other
    add column if not exists responsible_party_dob          date,
    add column if not exists responsible_party_phone        text,
    add column if not exists insurance_plan_name            text,
    add column if not exists insurance_group_number         text,
    add column if not exists insurance_plan_type            text,  -- PPO | HMO | EPO | HDHP
    add column if not exists insurance_effective_date       date,
    add column if not exists insurance_copay                numeric(8,2),
    add column if not exists insurance_deductible           numeric(10,2),
    add column if not exists secondary_payer_name           text,
    add column if not exists secondary_member_id            text,
    add column if not exists notes                          text,
    add column if not exists created_at                     timestamptz default now(),
    add column if not exists updated_at                     timestamptz default now();

-- Patient documents (lab results, appointment notes, referrals, etc.)
create table if not exists patient_documents (
    id              uuid primary key default gen_random_uuid(),
    patient_id      uuid not null references patients(id) on delete cascade,
    org_id          uuid,
    document_type   text not null,  -- lab_result | appointment_note | referral | imaging | insurance_card | other
    document_name   text not null,
    storage_path    text not null,  -- path in Supabase Storage
    uploaded_at     timestamptz not null default now(),
    notes           text
);
create index if not exists patient_documents_patient_idx on patient_documents (patient_id);

-- Patient appointments (upcoming and past)
create table if not exists patient_appointments (
    id              uuid primary key default gen_random_uuid(),
    patient_id      uuid not null references patients(id) on delete cascade,
    org_id          uuid,
    appointment_date date not null,
    appointment_time time,
    provider_name   text,
    appointment_type text,  -- office_visit | lab | imaging | follow_up | specialist | other
    status          text not null default 'scheduled',  -- scheduled | completed | cancelled | no_show
    notes           text,
    created_at      timestamptz not null default now()
);
create index if not exists patient_appointments_patient_idx on patient_appointments (patient_id);
create index if not exists patient_appointments_date_idx on patient_appointments (appointment_date);
