# ClaimPilot AI

Multi-agent AI system for end-to-end healthcare claims automation.

## Overview

ClaimPilot AI automates the full medical claims lifecycle—from superbill intake through payer submission, payment reconciliation, and appeals—using a coordinated team of specialized AI agents. A LangGraph supervisor orchestrates seven agents over a shared typed `ClaimState`, combining GPT-4o vision and reasoning with rules engines and ML models (denial-risk GradientBoosting, fraud Isolation Forest). Claims that need attention are routed to a human-in-the-loop (HITL) review queue with real interrupt/resume, and denied claims receive GPT-4o–drafted appeal letters.

## Architecture

### Agent Pipeline

| Agent | Role | Model/Method |
|-------|------|--------------|
| Intake | Vision extraction from superbills (PDF/image), incl. modifiers | GPT-4o vision + Pydantic structured outputs |
| Eligibility | 270/271 coverage, benefits (copay/coinsurance/deductible), prior auth | Mock payer service with plan tiers |
| Coding | ICD-10/CPT validation + medical necessity | GPT-4o reasoning |
| Scrub | Pre-submission edits (NPI Luhn, NCCI, MUE, modifier 25/59, timely filing, LCD) + CMS-1500 + denial risk | Rules engine + GradientBoosting ML |
| Submission | Adjudication against payer rules, CARC/RARC denials, appeal drafting | Deterministic adjudication engine + GPT-4o + Resend email |
| Reconciliation | Line-level 835/ERA posting, CO/PR/OA adjustments, variance detection | Rules engine |
| Fraud | Cross-claim anomaly detection | Isolation Forest |

### Tech Stack

| Backend | Frontend |
|---------|----------|
| FastAPI | Next.js 14 |
| LangGraph (supervisor pattern) | TypeScript |
| Pydantic v2 | Tailwind CSS |
| scikit-learn | shadcn/ui |
| SHAP | Framer Motion |
| OpenAI GPT-4o | Recharts |
| Supabase | SSE |

### Key Technical Features

- Deterministic payer adjudication engine: denials are caused by claim content (NCCI bundling, MUE units, missing modifier 25, prior auth, timely filing, LCD medical necessity, invalid NPI) with real CARC/RARC codes and line-level 835s with CO/PR/OA group codes
- Real pre-submission scrubber with rule citations (NPI-03, NCCI-01, MOD-25, TFL-01…) — hard errors block submission and route to human review
- GradientBoosting denial model trained on outcomes from the adjudication engine using only pre-submission features; SHAP factors rendered as billing-specialist explanations with probability impact
- Durable ClaimState snapshots persisted to Supabase after every pipeline step — claims, CMS-1500 downloads, and review/resume survive backend restarts
- True real-time SSE: agent events stream per graph step, with durable history in `agent_runs` and a `/claims/{id}/history` endpoint
- Context-aware HITL resume: approving a payment variance posts the payment; approving an eligibility hold re-runs from coding; review decisions are audit-logged
- Claim detail page shows service lines with line-level adjudication, 835 CAS adjustment codes, 271 benefits, and structured scrub findings
- Analytics: denial rate, top CARCs, payer performance, daily volume; claims work list with search, filters, and pagination
- Structured outputs (Pydantic schemas) on all LLM calls; per-field confidence scores on vision extraction with automatic HITL routing
- Isolation Forest anomaly detection for cross-claim billing pattern analysis
- CMS-1500 PDF generation via reportlab
- HIPAA-aware architecture: Supabase RLS, no PHI in logs, synthetic data only

## Setup

### Prerequisites

- Python 3.11
- Node.js 18+
- Poppler (for PDF→image conversion)
- Supabase project
- OpenAI API key
- Resend API key

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env` with your credentials:

```
OPENAI_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
RESEND_API_KEY=
MODEL_REASONING=gpt-4o
MODEL_FAST=gpt-4o-mini
MODEL_VISION=gpt-4o
```

Start the API server:

```powershell
uvicorn app.main:app --reload --port 8000
```

Or from the repo root: `.\start-backend.ps1`

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

Or from the repo root: `.\start-frontend.ps1`

### Seed Demo Data

From the `backend/` directory:

```powershell
python data/synthetic/seed.py
```

## Demo

1. Start the backend and frontend, then seed demo data to populate the dashboard with synthetic claims in various pipeline states.
2. Open the **Dashboard** (`/dashboard`) to view portfolio metrics, denial-risk trends, and the claims table.
3. Go to **Upload** (`/upload`) and drop a synthetic superbill PDF or image from `backend/data/synthetic/uploads/`.
4. On the claim detail page, watch the seven-agent pipeline execute in real time via the SSE activity feed and animated pipeline diagram, then inspect service lines with line-level payer adjudication, benefits, scrub findings, and the payment breakdown.
5. Resolve flagged claims in the **Review Queue** (`/review`) — approve or reject to resume the graph — then inspect denial-risk factors, download the CMS-1500 PDF, and read the auto-generated appeal letter for denied claims.
6. Use **Claims** (`/claims`) to search and filter the full work list, and **Analytics** (`/analytics`) for denial reasons by CARC, payer performance, and daily volume.

## Compliance Note

This is a prototype using synthetic data only. No real PHI was used at any stage. The architecture follows HIPAA-aware design principles (RLS, least-privilege, audit logging) but is not certified for production healthcare use without further compliance review.

## Author

Anish Chitnis — Software Engineering Intern, Ampcus Inc., June 2026
