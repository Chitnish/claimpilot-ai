# ClaimPilot AI

Multi-agent AI system for end-to-end healthcare claims automation.

## Overview

ClaimPilot AI automates the full medical claims lifecycle—from superbill intake through payer submission, payment reconciliation, and appeals—using a coordinated team of specialized AI agents. A LangGraph supervisor orchestrates seven agents over a shared typed `ClaimState`, combining GPT-4o vision and reasoning with rules engines and ML models (denial-risk GradientBoosting, fraud Isolation Forest). Claims that need attention are routed to a human-in-the-loop (HITL) review queue with real interrupt/resume, and denied claims receive GPT-4o–drafted appeal letters.

## Architecture

### Agent Pipeline

| Agent | Role | Model/Method |
|-------|------|--------------|
| Intake | Vision extraction from superbills (PDF/image) | GPT-4o vision + Pydantic structured outputs |
| Eligibility | 270/271 payer coverage verification | Mock payer service (270/271 simulation) |
| Coding | ICD-10/CPT validation + medical necessity | GPT-4o reasoning |
| Scrub | CMS-1500 generation + denial risk scoring | Rules engine + GradientBoosting ML (AUC 0.97) |
| Submission | Clearinghouse submission + appeal drafting | GPT-4o + Resend email |
| Reconciliation | 835/ERA line-by-line payment matching | Rules engine |
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

- LangGraph StateGraph with MemorySaver checkpointer for real interrupt/resume HITL
- Structured outputs (Pydantic schemas) on all LLM calls — no prompt engineering fragility
- Per-field confidence scores on vision extraction with automatic HITL routing
- GradientBoosting denial model trained on 5,000 synthetic claims, AUC 0.97, SHAP explainability
- Isolation Forest anomaly detection for cross-claim billing pattern analysis
- SSE streaming agent activity feed — every agent event logged to `agent_runs` table
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
4. On the claim detail page, watch the seven-agent pipeline execute in real time via the SSE activity feed and animated pipeline diagram.
5. Resolve flagged claims in the **Review Queue** (`/review`) — approve or reject to resume the graph — then inspect denial-risk factors, download the CMS-1500 PDF, and read the auto-generated appeal letter for denied claims.

## Compliance Note

This is a prototype using synthetic data only. No real PHI was used at any stage. The architecture follows HIPAA-aware design principles (RLS, least-privilege, audit logging) but is not certified for production healthcare use without further compliance review.

## Author

Anish Chitnis — Software Engineering Intern, Ampcus Inc., June 2026
