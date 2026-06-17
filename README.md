# ClaimPilot AI

Multi-agent AI system for end-to-end healthcare claims automation.

## Overview

ClaimPilot AI automates the full medical claims lifecycle—from superbill intake through payer submission, payment reconciliation, patient A/R, and appeals—using a coordinated team of specialized AI agents. A LangGraph supervisor orchestrates seven agents over a shared typed `ClaimState`, combining GPT vision/reasoning (models from env vars) with a rules engine, deterministic payer adjudication, and ML models (denial-risk GradientBoosting, fraud Isolation Forest + cross-claim pattern signals).

Claims that need attention route to a human-in-the-loop (HITL) review queue with interrupt/resume. Reviewers act under a demo RBAC layer (biller / supervisor / manager), with every privileged action stamped to an append-only audit log. The claim detail page includes a **Review Copilot** grounded in that claim's pipeline state. Denied claims can be **corrected and resubmitted** (frequency code 7) or receive GPT-drafted appeal letters via email.

## Architecture

### Agent Pipeline

| Agent | Role | Model/Method |
|-------|------|--------------|
| Intake | Vision extraction from superbills (PDF/image), incl. modifiers | Vision model + Pydantic structured outputs |
| Eligibility | 270/271 coverage, benefits (copay/coinsurance/deductible), prior auth | Mock payer service with plan tiers |
| Coding | ICD-10/CPT validation + medical necessity | Reasoning model |
| Scrub | Pre-submission edits (NPI Luhn, NCCI, MUE, modifier 25/59, timely filing, LCD) + CMS-1500 + denial risk | Rules engine + GradientBoosting ML |
| Submission | Adjudication against payer rules, CARC/RARC denials, appeal drafting | Deterministic adjudication engine + reasoning model + Resend email |
| Reconciliation | Line-level 835/ERA posting, CO/PR/OA adjustments, variance detection, patient statements | Rules engine + PDF statement generator |
| Fraud | Single-claim anomaly + cross-claim/provider pattern signals | Isolation Forest + statistical fraud engine |

### Tech Stack

| Backend | Frontend |
|---------|----------|
| FastAPI | Next.js 14 (App Router) |
| LangGraph (supervisor pattern) | TypeScript |
| Pydantic v2 | Tailwind CSS + shadcn/ui |
| scikit-learn + SHAP | Framer Motion + Recharts |
| OpenAI (env-driven models) | SSE (multi-subscriber) |
| Supabase (Postgres + Storage) | |

### Key Features

**Rules & adjudication**
- Authentic NCCI pairs (incl. status-B edits like 99000, panel unbundling), MUE limits, modifier 25 on immunization admin (90471), timely filing, LCD medical necessity
- Deterministic payer engine with real CARC/RARC codes and line-level 835s (CO/PR/OA)
- Pre-submission scrubber with rule citations (NPI-03, NCCI-01, MOD-25, TFL-01…)

**ML**
- Denial-risk model trained on adjudication-engine outcomes (not a hand-written formula)
- SHAP explanations in billing-specialist language
- Retrain after rule changes: `python -m app.ml.train` (artifacts: `backend/app/ml/*.pkl`, gitignored)

**Operations & compliance (Tier 1)**
- **RBAC demo**: sidebar user switcher (biller / supervisor / manager); default role is **manager** so the standard demo works with zero extra clicks
- **Audit trail**: append-only `audit_log` (approve/reject, PHI downloads, copilot access)
- **Corrected claims**: frequency code 7 resubmission with lineage on claim detail
- **Patient A/R**: itemized statements, `/ar` aging report (0–30 / 31–60 / 61–90 / 90+)
- **Honest metrics**: clean-claim rate, touch rate, measured pipeline time — correct denominators on Dashboard and Analytics
- **Work queue**: bulk approve/reject low-risk claims; CSV export on Claims work list
- **SSE**: multiple browser tabs on the same claim receive live agent events simultaneously

**Persistence**
- Full `ClaimState` snapshots in Supabase Storage after every pipeline step (survives backend restarts)
- Flat `claims` table + optional Postgres migrations for audit, lineage, and A/R columns
- Durable agent history in `agent_runs`

**Reviewer experience**
- Review Copilot (`POST /claims/{id}/chat`): grounded Q&A with citations and suggested actions
- Claim detail: service lines, scrub findings, benefits, payment breakdown, fraud signals, reviewer decision notes
- Batch upload (`POST /claims/upload-batch`): parallel pipelines per file

## Setup

### Prerequisites

- Windows + PowerShell
- Python 3.11
- Node.js 18+
- Poppler (for PDF→image conversion; on PATH in `start-*.ps1`)
- Supabase project
- OpenAI API key
- Resend API key (appeal emails)

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt --break-system-packages
```

Create `backend/.env`:

```
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
RESEND_API_KEY=
MODEL_REASONING=
MODEL_FAST=
MODEL_VISION=
CONFIDENCE_THRESHOLD=0.85
DENIAL_RISK_THRESHOLD=0.60
RECON_VARIANCE_TOLERANCE=0.05
```

`SUPABASE_DB_URL` is optional — only needed for `scripts/run_migrations.py` from your machine. If direct Postgres is unreachable from your network, apply migrations via the Supabase SQL Editor instead (see below).

Train ML models (skip if `backend/app/ml/denial_model.pkl` already exists):

```powershell
.\.venv\Scripts\python.exe -m app.ml.train
```

Start the API:

```powershell
uvicorn app.main:app --reload --port 8000
```

Or from repo root: `.\start-backend.ps1`

### Frontend

```powershell
cd frontend
npm install
```

Create `frontend/.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Start the dev server:

```powershell
npm run dev
```

Or from repo root: `.\start-frontend.ps1`

### Database migrations

Four additive SQL migrations live in `backend/migrations/`. Apply once via **Supabase Dashboard → SQL Editor** (recommended if direct Postgres fails from your network):

```
0001_claim_states.sql   — durable ClaimState table (forward-looking; app still uses Storage)
0002_audit_log.sql      — append-only audit trail
0003_corrected_claims.sql — correction lineage columns on claims
0004_patient_ar.sql     — patient balance / A/R columns on claims
```

A combined script is at `backend/migrations/combined_apply_all.sql`. Alternatively, from `backend/` with `SUPABASE_DB_URL` set:

```powershell
.\.venv\Scripts\python.exe scripts\run_migrations.py
```

### Seed & generate demo data

**Flat dashboard rows** (review-queue filler, no full pipeline):

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe data\synthetic\seed.py
```

**Uploadable superbill images** (run through the live pipeline for rules, A/R, fraud, corrections):

```powershell
.\.venv\Scripts\python.exe data\synthetic\generate.py
```

Outputs: `backend/data/synthetic/superbill_*.png` — upload via **Upload** in the UI.

### Smoke tests

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
.\.venv\Scripts\python.exe tests\smoke_scrubber.py
.\.venv\Scripts\python.exe tests\smoke_adjudication.py
.\.venv\Scripts\python.exe tests\smoke_fraud.py
```

## Demo walkthrough

1. Start backend and frontend. Optionally run `seed.py` for dashboard filler, then `generate.py` and upload superbills for full-pipeline demos.
2. **Dashboard** (`/dashboard`) — honest KPIs: clean-claim rate, denial rate, touch rate, measured processing time, estimated labor savings (with assumptions labeled).
3. **Upload** (`/upload`) — drop one or more superbill PNGs/PDFs; each file runs its own parallel pipeline. Open the claim detail page and watch the SSE live feed.
4. **SSE multi-tab test** — open the same `/claims/{id}` URL in two browser tabs while processing; both should show agent events updating in real time.
5. **Review Queue** (`/review`) — approve or reject flagged claims (optional comment). Use checkboxes + **Select low-risk** + **Approve selected** for bulk actions. Default actor is **manager** (Alex Morgan) — no switcher interaction required for the happy path.
6. **RBAC** — switch sidebar to **Jordan Lee (biller)** and try approving a high-dollar or high-risk claim; switch to supervisor/manager to clear it.
7. **Claim detail** — scrub findings, denial-risk SHAP factors, fraud `anomaly_reasons`, Review Copilot, CMS-1500 download, corrected-claim panel (on denied claims), patient statement (after reconciliation).
8. **Accounts Receivable** (`/ar`) — aging buckets and open patient balances (populated after claims reconcile with patient responsibility).
9. **Claims** (`/claims`) — search, filter, paginate, **Export CSV**.
10. **Analytics** (`/analytics`) — operational KPIs, CARC breakdown, payer performance, daily volume.

## API highlights

| Endpoint | Purpose |
|----------|---------|
| `POST /claims/upload` | Single superbill upload |
| `POST /claims/upload-batch` | Parallel multi-file upload |
| `GET /claims/{id}/events` | SSE live agent feed |
| `POST /claims/{id}/resume` | HITL approve/reject (RBAC-gated) |
| `POST /review/bulk-resume` | Bulk approve/reject |
| `POST /claims/{id}/correct` | Corrected claim (freq 7) |
| `POST /claims/{id}/chat` | Review Copilot |
| `GET /claims/export.csv` | Filtered work-list export |
| `GET /ar/aging` | Patient A/R aging report |
| `GET /analytics` | Operational metrics |

Actor identity travels as `X-Actor-Id`, `X-Actor-Name`, `X-Actor-Role` headers (set by the frontend sidebar switcher).

## Compliance Note

This is a prototype using **synthetic data only**. No real PHI was used at any stage. The architecture follows HIPAA-aware design principles (RLS, least-privilege, audit logging) but is not certified for production healthcare use without further compliance review.

## Author

Anish Chitnis — Software Engineering Intern, Ampcus Inc., June 2026
