# ClaimPilot AI

Multi-agent AI platform for end-to-end medical claims automation — from superbill intake through payer adjudication, human review, appeals, dispute email handling, patient A/R, and analytics.

## Overview

ClaimPilot AI targets the revenue-cycle workflow a medical billing office runs daily: extract data from a superbill, verify coverage, validate coding, scrub against payer edits, predict denial risk, submit to a payer, reconcile remittance, and collect patient balances. Rather than a single monolithic model, a **LangGraph supervisor** routes each claim through **seven specialized agents** over one shared, typed `ClaimState` object. GPT vision and reasoning handle unstructured document extraction, coding review, appeal letters, dispute replies, and the Review Copilot; deterministic rules and a mock payer engine enforce real billing edits (NCCI, MUE, modifier 25, timely filing, LCD medical necessity); scikit-learn models score denial risk (GradientBoosting + SHAP) and billing anomalies (Isolation Forest plus cross-claim fraud signals).

Claims that hit defined risk gates pause at a **human-in-the-loop (HITL)** checkpoint implemented with LangGraph `interrupt`. Reviewers approve or reject via the UI under a demo **RBAC layer** (biller / supervisor / manager), with privileged actions written to an append-only **audit log**. Denied claims can receive GPT-drafted appeal letters sent through **Resend**, continue in an **AI-managed email dispute thread** (with escalation to human review), or be **corrected and resubmitted** as frequency-code-7 replacement claims. Patient profiles, appointments, documents, statements, and an A/R aging report extend the demo beyond claims-only processing.

All patient and claim data is **synthetic**. This is an engineering prototype, not a certified production RCM product.

## Architecture

### Agent Pipeline

| Agent | Role | Method |
|-------|------|--------|
| **Intake** | Extract patient, payer, provider, DOS, and service lines (CPT, modifiers, ICD-10, charges) from uploaded superbill PDF/image; flag low-confidence header fields | GPT vision (`MODEL_VISION`) + Pydantic structured output |
| **Eligibility** | Simulate 270/271: active coverage, plan tier, copay/coinsurance/deductible, prior-auth CPT list and auth-on-file flag; route terminated coverage to review | Deterministic mock payer (`check_eligibility`) |
| **Coding** | Validate ICD-10/CPT format, medical-necessity linkage, modifier use, unbundling | GPT reasoning (`MODEL_REASONING`) + structured `CodingReview` |
| **Scrub** | Pre-submission edits (NPI Luhn, identifiers, dates, NCCI, MUE, modifier 25/59, timely filing, prior auth, LCD); generate CMS-1500 PDF; score ML denial risk | Rules engine (`scrubber.py`) + GradientBoosting ML + ReportLab PDF |
| **Submission** | Submit to mock clearinghouse; line-level adjudication; draft appeal letters for clinical denials or route administrative denials to review with corrective actions | Deterministic adjudication (`adjudicate_claim`) + GPT appeal drafting + Resend (manual send) |
| **Reconciliation** | Parse simulated 835/ERA; compare expected vs paid; flag payment variance; open patient A/R and generate/email patient statement | Deterministic ERA (`generate_era`) + ReportLab statement PDF + Resend |
| **Fraud** | Fuse single-claim Isolation Forest anomaly score with cross-claim signals (charge outlier, duplicate clone, E/M upcoding skew, volume spike) | ML + in-process statistical engine (`fraud_signals.py`) |

**Supervisor routing** (`backend/app/graph/pipeline.py`): draft → intake (if document, no lines) → eligibility → coding → scrub → submission → reconciliation (once, when `era` empty) → fraud (terminal states, once) → end. **`human_review`** node calls LangGraph `interrupt` when `needs_human_review` is true; `/claims/{id}/resume` clears the flag and resumes the graph.

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Next.js frontend (localhost:3000)                                          │
│  Dashboard · Claims · Upload · Review · Disputes · Patients · A/R · Analytics│
└───────────────────────────────┬─────────────────────────────────────────────┘
                                │ REST + SSE (agent events)
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  FastAPI backend (localhost:8000)                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ LangGraph supervisor → Intake → Eligibility → Coding → Scrub →       │   │
│  │ Submission → Reconciliation → Fraud (+ Human Review interrupt)       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└───────┬─────────────────┬──────────────────┬──────────────────────────────┘
        │                 │                  │
        ▼                 ▼                  ▼
  OpenAI API        Supabase Postgres     Supabase Storage
  (vision/reason)   claims, patients,     claim-states/*.json
                    agent_runs,           patient-documents/*
                    review_queue,         cms1500 / statement PDFs (local disk)
                    audit_log, …
        │
        ▼
  Resend (outbound appeal + statement + dispute replies)
        ▲
        │ inbound webhook: POST /webhooks/resend-inbound
        │
┌───────┴───────────────────────────────────────────────────────────────────────┐
│  Separate Render deployment (recommended for dispute demo)                    │
│  Public HTTPS endpoint for Resend inbound emails → same Supabase project      │
│  Local backend reads dispute_thread / has_pending_dispute from Storage        │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Backend (installed in `.venv`; `requirements.txt` lists unpinned deps) | Frontend (`frontend/package.json`) |
|--------|----------|
| Python 3.11 | Next.js **16.2.9** |
| FastAPI **0.136.3** | React **19.2.7** / React DOM **19.2.7** |
| Uvicorn **0.49.0** | TypeScript **^5** |
| sse-starlette **3.4.4** | Tailwind CSS **3.4.1** |
| Pydantic **2.13.4** | shadcn **4.11.0**, radix-ui **1.5.0** |
| LangGraph **1.2.4**, langchain-openai **1.3.0** | Framer Motion **12.40.0**, Recharts **3.8.1** |
| OpenAI **2.41.0** | react-dropzone **15.0.0**, react-markdown **10.1.0** |
| scikit-learn **1.9.0**, SHAP **0.51.0** | Zod **4.4.3** |
| Supabase Python **2.31.0** | @supabase/supabase-js **^2.108.1** |
| Resend **2.30.1**, httpx **0.28.0** | Geist fonts (via `next/font`) |
| ReportLab **4.5.1**, pdf2image **1.17.0**, pdfplumber **0.11.9** | ESLint **^8**, eslint-config-next **14.2.35** |
| pandas **3.0.3**, numpy **2.4.6**, Faker **40.22.0** | |

## Key Features

### Claims Processing

- **Single upload** (`POST /claims/upload`) and **batch upload** (`POST /claims/upload-batch`): PDF/PNG/JPG superbills; one claim per file; parallel pipeline tasks.
- **Real-time SSE feed** (`GET /claims/{id}/events`): multi-subscriber fan-out, backfill from Storage/`agent_runs`, survives tab refresh.
- **Full claim detail** (`GET /claims/{id}`): rehydrates `ClaimState` from memory, Supabase Storage snapshot, or flat `claims` row.
- **CMS-1500 PDF** (`GET /claims/{id}/cms1500`) generated at scrub; includes box 22 resubmission fields for corrected claims.
- **Pipeline diagram** on claim detail: visual progress through all seven agents plus human-review pause.
- **Corrected claims** (`POST /claims/{id}/correct`): frequency code **7** (replacement) or **8** (void); links `original_claim_id` and `original_payer_control_number`; re-enters pipeline at **coded**; audit trail on both claims.
- **Claims work list** (`GET /claims/search`): text search (ID, payer, CARC), status/payer filters, pagination, payer facets.
- **CSV export** (`GET /claims/export.csv`): same filters as work list.

### Risk & Compliance

- **Scrubber rules** with cited rule IDs:
  - Identifiers: NPI-01/02/03 (Luhn), SUB-01–04 (member ID, name, DOB, payer)
  - Dates: DOS-01–03, TFL-01/02 (timely filing vs payer-specific limits: 90–365 days)
  - Lines: LN-01–04 (diagnosis pointer, charge, units)
  - Codes: CPT-01/02, ICD-01/02, MOD-01–03
  - NCCI-01 (99000 status-B bundling, 80053/80048 panel unbundling), MOD-25 (E/M + 90471 same day)
  - MUE-01, AUTH-01, LCD-01 (medical necessity by diagnosis prefix)
- **Denial-risk ML**: GradientBoosting trained on **8,000** synthetic claims through the real adjudication engine; training asserts **AUC > 0.75**; default threshold **0.60** (`DENIAL_RISK_THRESHOLD`); SHAP factors rendered in plain English.
- **Anomaly / fraud**: Isolation Forest on charge/lines/dx/MUE shape; cross-claim signals for charge z-score, duplicate clone, E/M upcoding skew (≥80% level 4/5), improbable daily volume (≥15 claims/DOS/NPI).
- **Mock payer adjudication**: deterministic by claim content (NPI, member ID, eligibility, filing age, duplicates, NCCI, MUE, modifier 25, LCD, prior auth); real CARC/RARC catalogs; line-level CO-45 contractual adjustment and PR-1/2/3 patient responsibility; ~10% intentional ERA underpayment for variance testing.

### Human Oversight

- **Review queue** (`GET /review`, `review_queue` table): open items with reason and details (denial risk, scrub errors, low-confidence fields, CARC corrective actions, reconciliation variance).
- **HITL gates**: low extraction confidence (`CONFIDENCE_THRESHOLD` default **0.85**); scrub hard errors; denial risk ≥ threshold; terminated coverage; administrative denial; reconciliation variance > **5%** (`RECON_VARIANCE_TOLERANCE`).
- **Approve / reject** (`POST /claims/{id}/resume`): approval resumes pipeline (restart point depends on review reason); rejection drafts appeal (CARC 50) or keeps in review; variance approval accepts posted payment and finalizes A/R.
- **Bulk resume** (`POST /review/bulk-resume`): up to 100 claims; per-claim RBAC; partial failure safe.
- **RBAC** (demo headers, not real auth):
  - Roles: **biller**, **supervisor**, **manager** (default **manager** if header missing)
  - Demo users: Jordan Lee (biller), Sam Rivera (supervisor), Alex Morgan (manager)
  - Billers cannot approve: payment-variance write-offs; claims over **$500** (`BILLER_APPROVAL_MAX_CHARGE`); denial risk ≥ **75%** (`BILLER_APPROVAL_MAX_RISK`)
  - Rejection always allowed for any role
- **Audit log** (`audit_log` table, best-effort): `approve_claim`, `reject_claim`, `approve_denied`, `download_cms1500`, `download_statement`, `view_copilot`, `send_appeal_email`, `resolve_dispute`, `resubmit_corrected` — append-only via DB triggers.

### Patient Management

- **Auto-enrichment**: after pipeline, `upsert_patient_from_claim` creates/updates patient by member ID + payer; links claim via `encounters` row.
- **Patient directory** (`GET /patients`): search by name, member ID, payer, phone; claim aggregates and last visit.
- **Patient detail** (`GET /patients/{id}`): demographics, address, contacts, emergency contact, responsible party, primary/secondary insurance, notes; linked claims; appointments; documents with signed download URLs.
- **CRUD**: `PUT /patients/{id}` profile update; `POST/DELETE` appointments; document metadata, upload (`POST .../documents/upload` to Storage), delete.

### Financial Operations

- **835/ERA reconciliation**: expected vs paid variance; line-level denials and underpayments; human review on tolerance breach.
- **Patient A/R**: `patient_balance`, `ar_status` (`open` / `paid`), `statement_date` on claims; itemized **patient statement PDF**; optional **statement email** with PDF attachment after reconciliation.
- **A/R aging** (`GET /ar/aging`): buckets **0–30**, **31–60**, **61–90**, **90+** days; total outstanding; open accounts list (requires migration 0004 columns).

### Dispute Resolution

- **Appeal drafting**: on clinical denials (CARC **50, 97, 151, 197, 11, 4, 96**) or reviewer rejection; plain-text letters via GPT.
- **Send appeal** (`POST /claims/{id}/send-appeal`): Resend HTML email; subject `Appeal — Claim {id[:8]} — {patient}`; sets `appeal_email_sent`.
- **Inbound dispute webhook** (`POST /webhooks/resend-inbound`): Resend `email.received` events; parses claim ID from subject; fetches body via Resend Receiving API; AI reply (`generate_dispute_reply`); persists thread to `dispute_threads` + Storage; sends threaded reply; **escalation** when payer replies affirmatively after AI's yes/no escalation question → `has_pending_dispute = true`.
- **Pending disputes** (`GET /disputes/pending`); **resolve** (`POST /disputes/{id}/resolve`) clears flag with audit note.

### Analytics

- **`GET /analytics`** (last 1000 claims): total claims/billed; **denial rate** and **clean-claim rate** over adjudicated claims only; **touch rate** (claims in `review_queue` ÷ adjudicated); **auto-processed count**; **avg pipeline seconds** from summed `agent_runs.latency_ms`; **avg denial risk**; **high-risk open** count; status histogram; top CARC reasons; per-payer stats; 14-day daily volume; **business impact** estimate (12 min manual time × $45/hr on auto-processed claims — definitions returned in `metric_definitions`).
- **Frontend `/analytics`**: KPI cards, status bar chart, CARC bar chart, payer table, daily volume area chart, metric definition footnotes.
- **Dashboard `/dashboard`**: command-center hero, clean-claim/touchless/billed KPIs, recent claims table, denial-risk distribution (local bucket chart), polls every 10s.

### Review Copilot

- **`POST /claims/{id}/chat`**: grounded Q&A on single claim's `ClaimState` snapshot + last 20 agent events; structured response with `reply`, `citations`, `suggested_actions`; uses `MODEL_FAST` or `MODEL_REASONING` based on question triggers; audit logged as `view_copilot`.
- **UI component** on claim detail with starter prompts and optional plain-language mode.

## Database Schema

Base tables (`orgs`, `claims`, `patients`, `encounters`, `agent_runs`, `review_queue`) are required in Supabase but are **not** created by repo migrations — they must exist before seeding or upload. Migrations in `backend/migrations/` are additive.

| Table | Description |
|-------|-------------|
| `orgs` | Demo organization row referenced by claims, patients, and encounters |
| `claims` | Flat claim work-list row: status, payer, charges, denial risk, CARC/RARC, appeal fields, reviewer fields, A/R columns, dispute flag, correction lineage columns |
| `patients` | Patient demographics and insurance profile (extended by migration 0007) |
| `encounters` | Links a claim to a patient, provider, and date of service |
| `agent_runs` | Durable per-step agent activity: agent, event, summary, payload, latency_ms |
| `review_queue` | Open/closed HITL queue items with reason and JSON details |
| `claim_states` | *(migration 0001)* Optional Postgres JSONB snapshot of full `ClaimState`; app currently persists to **Storage** instead |
| `audit_log` | *(0002)* Append-only attributable audit trail with immutability triggers |
| `dispute_threads` | *(0006)* Email thread messages: sender (`payer_reply`, `ai_reply`), text, optional `resend_email_id` |
| `patient_documents` | *(0007)* Document metadata + Storage path per patient |
| `patient_appointments` | *(0007)* Scheduled/completed appointments per patient |

**Storage bucket `documents`**: `claim-states/{claim_id}.json` (full pipeline state); `patient-documents/{patient_id}/…`.

**Migration order**: `0001` → `0002` → `0003` → `0004` → `0005` → `0006` → `0007`. Single-paste script: `backend/migrations/combined_apply_all.sql` (all seven migrations; requires base tables to exist first).

## Setup

### Prerequisites

- Windows + PowerShell (paths with parentheses must be quoted)
- Python **3.11**
- Node.js **18+**
- **Poppler** on PATH for PDF→image intake (default probe: `C:\poppler\poppler-24.08.0\Library\bin`; override with `POPPLER_PATH`)
- Supabase project with base tables, `documents` Storage bucket, and at least one `orgs` row
- OpenAI API key
- Resend API key (appeals, statements, dispute replies; optional for core pipeline)

### Backend setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Copy `backend/.env.example` to `backend/.env` and fill in values:

```env
# Required
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=

# Email (appeals, statements, disputes)
RESEND_API_KEY=
ALERT_FROM_EMAIL=onboarding@resend.dev
ALERT_TO_EMAIL=
RESEND_INBOUND_ADDRESS=

# Models (defaults shown)
MODEL_REASONING=gpt-4o
MODEL_FAST=gpt-4o-mini
MODEL_VISION=gpt-4o-mini

# Pipeline thresholds
CONFIDENCE_THRESHOLD=0.85
DENIAL_RISK_THRESHOLD=0.60
RECON_VARIANCE_TOLERANCE=0.05

# RBAC demo limits
BILLER_APPROVAL_MAX_CHARGE=500
BILLER_APPROVAL_MAX_RISK=0.75

# Optional
POPPLER_PATH=
SUPABASE_DB_URL=
```

Train ML models (skip if `backend/app/ml/denial_model.pkl` already present):

```powershell
.\.venv\Scripts\python.exe -m app.ml.train
```

Start API:

```powershell
uvicorn app.main:app --reload --port 8000
```

Or from repo root: `.\start-backend.ps1`

Health check: `GET http://localhost:8000/health` → `{"status":"ok","version":"0.2.0"}`

### Frontend setup

```powershell
cd frontend
npm install
```

Copy `frontend/.env.local.example` to `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start dev server:

```powershell
npm run dev
```

Or from repo root: `.\start-frontend.ps1`

App root `/` redirects to `/dashboard`.

### Environment variables (reference)

| Variable | Purpose |
|----------|---------|
| `OPENAI_API_KEY` | Required. GPT vision, reasoning, fast, and copilot calls |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Required. Postgres + Storage client |
| `SUPABASE_DB_URL` | Optional. Direct Postgres for `scripts/run_migrations.py` |
| `RESEND_API_KEY` | Outbound/inbound email via Resend |
| `ALERT_FROM_EMAIL` | Sender address (default `onboarding@resend.dev`) |
| `ALERT_TO_EMAIL` | Demo recipient for appeals, statements, dispute replies |
| `RESEND_INBOUND_ADDRESS` | Reply-To / inbound routing address for dispute threading |
| `MODEL_REASONING`, `MODEL_FAST`, `MODEL_VISION` | OpenAI model slugs |
| `CONFIDENCE_THRESHOLD` | Intake HITL gate (default 0.85) |
| `DENIAL_RISK_THRESHOLD` | Scrub HITL gate (default 0.60) |
| `RECON_VARIANCE_TOLERANCE` | Reconciliation variance fraction (default 0.05) |
| `BILLER_APPROVAL_MAX_CHARGE`, `BILLER_APPROVAL_MAX_RISK` | RBAC biller approval limits |
| `POPPLER_PATH` | pdf2image Poppler binaries directory |
| `NEXT_PUBLIC_API_URL` | Frontend → backend base URL |

Request headers for demo identity (set automatically by frontend): `X-Actor-Id`, `X-Actor-Name`, `X-Actor-Role`.

### Seeding demo data

**Dashboard filler** (10 flat claims + patients + appointments; no live pipeline):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe data\synthetic\seed.py
```

Statuses seeded: 3 reconciled, 2 needs_review, 2 appealed, 2 submitted, 1 denied.

**Uploadable superbills** (PDF; mix of clean and deniable scenarios):

```powershell
.\.venv\Scripts\python.exe data\synthetic\generate.py
# optional: .\.venv\Scripts\python.exe data\synthetic\generate.py 5
```

Upload outputs from `backend/data/synthetic/superbill_*.pdf` via **Upload** in the UI.

### Database migrations

Apply in Supabase **SQL Editor** (recommended) or:

```powershell
cd backend
.\.venv\Scripts\python.exe scripts\run_migrations.py
```

(requires `SUPABASE_DB_URL`)

## Demo Flow

A realistic end-to-end walkthrough using actual routes:

1. **Start** backend (`:8000`) and frontend (`:3000`). Optionally run `seed.py` for dashboard filler, then `generate.py` for uploadable superbills.

2. **Upload** — open [`/upload`](http://localhost:3000/upload). Drop one or more superbill PDFs/PNGs. Single file redirects to [`/claims/{id}`](http://localhost:3000/claims); batch shows links to each new claim. Watch the **SSE live feed** and **pipeline diagram** as agents run.

3. **Pipeline pause** — if intake, eligibility, scrub, submission, or reconciliation triggers review, SSE emits `paused` and status becomes `needs_review`. Open [`/review`](http://localhost:3000/review) to see the queue (sidebar badge).

4. **Review Copilot** — on claim detail, ask *"Why is this in review?"* or *"What corrections are needed?"* Copilot answers from claim context only.

5. **Approve or reject** — on [`/review`](http://localhost:3000/review) or claim detail:
   - **Approve** (manager/supervisor, or biller within limits): pipeline resumes from extracted or scrubbed depending on reason; variance approval accepts payment and posts A/R.
   - **Reject**: drafts appeal letter (status `appealed`) for high denial-risk holds.
   - Try **Jordan Lee (biller)** from the sidebar on a high-dollar claim to see RBAC block (403).

6. **Appeal & send** — on an appealed/denied claim detail, edit the appeal letter and click **Send Appeal** (`POST /claims/{id}/send-appeal`). Requires `ALERT_TO_EMAIL` and Resend config.

7. **Dispute thread** — reply to the appeal email (inbound to Resend). With the webhook deployed (see Deployment Notes), the AI responds and asks about escalation. Reply **yes** to flag [`/disputes`](http://localhost:3000/disputes). Resolve from the disputes page.

8. **Correct & resubmit** — on a denied claim, use **Correct Claim** panel: edit modifiers/ICD-10, provide reason, file frequency-7 replacement; new claim runs pipeline from coding.

9. **Reconciliation & A/R** — after successful adjudication, reconciliation posts ERA; patient statement PDF and optional email generate when `patient_responsibility > 0`. View aging at [`/ar`](http://localhost:3000/ar).

10. **Analytics & export** — [`/analytics`](http://localhost:3000/analytics) for operational KPIs; [`/claims`](http://localhost:3000/claims) to search/filter and **Export CSV**; [`/patients`](http://localhost:3000/patients) for enriched profiles linked from processed claims.

## Deployment Notes

**Dual-environment setup for disputes:**

- Run the **main demo** locally: FastAPI on port 8000 + Next.js on port 3000, both pointing at the same Supabase project.
- **Resend inbound webhooks** require a **public HTTPS URL**. Deploy a second FastAPI instance (commonly **Render** free tier) exposing only `POST /webhooks/resend-inbound` (or the full app). Configure Resend to POST inbound events to that URL.
- Both environments share the **same Supabase project**. The webhook instance writes `dispute_thread` and `has_pending_dispute` to **Supabase Storage** (`claim-states/{id}.json`); the local backend merges those fields on `GET /claims/{id}` via `_apply_storage_dispute_fields`.
- Free-tier Render services **cold-start** after idle periods; first webhook or health check may be slow.
- CORS on the local API allows `http://localhost:3000` only.

## Known Limitations

- **Synthetic data only** — Faker-generated patients; demo NPI `1234567893`; no real PHI.
- **Curated rule coverage** — NCCI pairs, MUE limits, LCD mappings, and fee schedules cover the demo CPT universe (~15 codes), not a commercial scrubber's full edit library.
- **Single-org assumption** — one demo `orgs` row; no multi-tenant isolation beyond RLS placeholders.
- **Demo RBAC** — header-based identity switcher, not SSO, JWT, or Postgres RLS tied to users.
- **In-process fraud baselines** — cross-claim signals reset on backend restart; not warehouse-persisted.
- **ClaimState primary persistence** — Supabase Storage, not the `claim_states` Postgres table (migration exists for future use).
- **Mock payer only** — no live clearinghouse, EDI, or payer APIs.
- **ML irreducible uncertainty** — training features exclude hidden payer state (auth on file, coverage termination); model AUC ~0.75+ on synthetic distribution, not production calibration.
- **Dashboard business-impact math** on `/dashboard` uses a local 2.5 hr/claim estimate for one hero section; `/analytics` uses the backend's 12 min/claim definition.

## Compliance Note

This project uses **synthetic data only**. No real protected health information (PHI) was collected, stored, or processed. The architecture includes HIPAA-aware design patterns (audit logging, least-privilege intent, RLS on migrated tables) as a prototype exercise, but ClaimPilot AI is **not certified** for production healthcare use and has not undergone formal compliance review.

## Author

Anish Chitnis — AI Engineering Intern, Ampcus Inc.
