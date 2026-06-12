from __future__ import annotations
import asyncio, json, os, shutil, uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from dotenv import load_dotenv
load_dotenv()

from app.schemas.claim_state import ClaimState, ClaimStatus
from app.graph.pipeline import pipeline
from app.services.supabase_client import get_supabase

UPLOAD_DIR = Path("data/synthetic/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# In-memory store for SSE streaming (replaced by DB pub/sub in Phase 3)
_claim_events: dict[str, list[dict]] = {}
_claim_states: dict[str, ClaimState] = {}
_claim_queues: dict[str, asyncio.Queue] = {}


async def push_event(claim_id: str, event: dict) -> None:
    """Push an agent event to both the SSE buffer and the live queue."""
    _claim_events.setdefault(claim_id, []).append(event)
    q = _claim_queues.get(claim_id)
    if q:
        await q.put(event)


class ResumeDecision(BaseModel):
    approved: bool
    reviewer_notes: str = ""


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify DB connection on startup
    try:
        get_supabase().table("orgs").select("id").limit(1).execute()
        print("[startup] Supabase connected ✓")
    except Exception as e:
        print(f"[startup] Supabase connection error: {e}")
    yield


app = FastAPI(title="ClaimPilot AI", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.2.0"}


@app.post("/claims/upload")
async def upload_document(file: UploadFile = File(...)):
    """Accept a superbill upload and run the full pipeline."""
    claim_id = str(uuid.uuid4())
    suffix = Path(file.filename).suffix or ".png"
    dest = UPLOAD_DIR / f"{claim_id}{suffix}"

    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Get demo org_id
    try:
        row = get_supabase().table("orgs").select("id").limit(1).execute()
        org_id = row.data[0]["id"] if row.data else ""
    except Exception:
        org_id = ""

    # Persist initial claim row
    try:
        get_supabase().table("claims").insert({
            "id": claim_id,
            "org_id": org_id,
            "encounter_id": None,
            "status": "draft",
        }).execute()
    except Exception as e:
        print(f"[upload] claim insert error: {e}")

    initial_state = ClaimState(
        claim_id=claim_id,
        org_id=org_id,
        document_storage_path=str(dest),
    )
    _claim_events[claim_id] = []
    _claim_states[claim_id] = initial_state
    _claim_queues[claim_id] = asyncio.Queue()

    # Run pipeline in background
    asyncio.create_task(_run_pipeline(claim_id, initial_state))

    return {"claim_id": claim_id, "status": "processing"}


async def _run_pipeline(claim_id: str, state: ClaimState):
    try:
        config = {"configurable": {"thread_id": claim_id}, "recursion_limit": 100}
        final_state_dict = await pipeline.ainvoke(state.model_dump(), config=config)
        final_state = ClaimState(**final_state_dict)
        _claim_states[claim_id] = final_state

        # Push all events — but do it one by one with a small delay for streaming effect
        for ev in final_state.agent_events:
            ev_dict = ev.model_dump()
            if ev_dict not in _claim_events.get(claim_id, []):
                await push_event(claim_id, ev_dict)
                await asyncio.sleep(0.3)  # 300ms between events for visual streaming

        try:
            get_supabase().table("claims").update({
                "status":               final_state.status.value,
                "total_charge":         final_state.total_charge,
                "denial_risk":          final_state.denial_risk,
                "denial_risk_factors":  final_state.denial_risk_factors,
                "carc_code":            final_state.carc_code or None,
                "rarc_code":            final_state.rarc_code or None,
                "appeal_letter":        final_state.appeal_letter or None,
                "cms1500_path":         final_state.cms1500_path or None,
            }).eq("id", claim_id).execute()
        except Exception as e:
            print(f"[pipeline] claim update error: {e}")

    except Exception as exc:
        print(f"[pipeline] error for {claim_id}: {exc}")
        await push_event(claim_id, {
            "agent": "system", "event": "error",
            "summary": f"Pipeline error: {str(exc)[:120]}",
        })


@app.get("/claims/{claim_id}/events")
async def stream_events(claim_id: str):
    """SSE endpoint — streams agent events via queue for real-time delivery."""
    q: asyncio.Queue = asyncio.Queue()
    _claim_queues[claim_id] = q

    async def generator():
        # First send any already-buffered events
        for ev in _claim_events.get(claim_id, []):
            yield {"data": json.dumps(ev)}

        # Then stream new events from the queue
        timeout_count = 0
        while timeout_count < 300:
            try:
                ev = await asyncio.wait_for(q.get(), timeout=1.0)
                yield {"data": json.dumps(ev)}
                # Check terminal state
                state = _claim_states.get(claim_id)
                if state and state.status.value in ("reconciled", "appealed", "paid"):
                    yield {"data": json.dumps({"agent": "system", "event": "done",
                                               "summary": "Pipeline complete."})}
                    return
            except asyncio.TimeoutError:
                timeout_count += 1
                # Check if pipeline is done even without new events
                state = _claim_states.get(claim_id)
                if state and state.status.value in ("reconciled", "appealed", "paid"):
                    yield {"data": json.dumps({"agent": "system", "event": "done",
                                               "summary": "Pipeline complete."})}
                    return

        # Cleanup
        _claim_queues.pop(claim_id, None)

    return EventSourceResponse(generator())


@app.get("/claims/{claim_id}")
async def get_claim(claim_id: str):
    state = _claim_states.get(claim_id)
    if not state:
        # Fallback to DB
        try:
            row = get_supabase().table("claims").select("*").eq("id", claim_id).single().execute()
            return row.data
        except Exception:
            raise HTTPException(404, "Claim not found")
    return state.model_dump()


@app.get("/claims")
async def list_claims():
    try:
        rows = get_supabase().table("claims").select("*").order(
            "created_at", desc=True).limit(20).execute()
        return rows.data
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/claims/{claim_id}/cms1500")
async def download_cms1500(claim_id: str):
    state = _claim_states.get(claim_id)
    if not state or not state.cms1500_path:
        raise HTTPException(404, "CMS-1500 not generated yet")
    return FileResponse(state.cms1500_path, media_type="application/pdf",
                        filename=f"cms1500_{claim_id[:8]}.pdf")


def _in_memory_review_items() -> list[dict]:
    items: list[dict] = []
    for claim_id, state in _claim_states.items():
        if state.needs_human_review and state.status == ClaimStatus.NEEDS_REVIEW:
            items.append({
                "id": claim_id,
                "claim_id": claim_id,
                "reason": state.review_reason,
                "details": {
                    "denial_risk": state.denial_risk,
                    "low_confidence_fields": state.low_confidence_fields,
                },
                "created_at": "",
                "claim_status": state.status.value,
                "total_charge": state.total_charge,
                "patient_name": state.patient_name,
                "denial_risk": state.denial_risk,
            })
    return items


def _claim_fields_for_review(claim_id: str) -> dict:
    state = _claim_states.get(claim_id)
    if state:
        return {
            "claim_status": state.status.value,
            "total_charge": state.total_charge,
            "patient_name": state.patient_name,
            "denial_risk": state.denial_risk,
        }
    try:
        row = (
            get_supabase()
            .table("claims")
            .select("status, total_charge, denial_risk")
            .eq("id", claim_id)
            .single()
            .execute()
        )
        data = row.data or {}
        return {
            "claim_status": data.get("status", ""),
            "total_charge": data.get("total_charge") or 0,
            "patient_name": "",
            "denial_risk": data.get("denial_risk") or 0,
        }
    except Exception:
        return {
            "claim_status": "",
            "total_charge": 0,
            "patient_name": "",
            "denial_risk": 0,
        }


@app.get("/review")
async def list_review_queue():
    try:
        rows = (
            get_supabase()
            .table("review_queue")
            .select("*")
            .eq("status", "open")
            .execute()
        )
        items: list[dict] = []
        for row in rows.data or []:
            claim_id = row["claim_id"]
            state = _claim_states.get(claim_id)
            if state:
                claim_status = state.status.value
                total_charge = state.total_charge
                patient_name = state.patient_name
                denial_risk = state.denial_risk
            else:
                fields = _claim_fields_for_review(claim_id)
                claim_status = fields["claim_status"]
                total_charge = fields["total_charge"]
                patient_name = fields["patient_name"]
                denial_risk = fields["denial_risk"]
            items.append({
                "id": row["id"],
                "claim_id": claim_id,
                "reason": row.get("reason", ""),
                "details": row.get("details") or {},
                "created_at": row.get("created_at", ""),
                "claim_status": claim_status,
                "total_charge": total_charge,
                "patient_name": patient_name,
                "denial_risk": denial_risk,
            })
        return items
    except Exception as e:
        print(f"[review] Supabase query error: {e}")
        return _in_memory_review_items()


@app.post("/claims/{claim_id}/review-queue")
async def enqueue_review(claim_id: str):
    state = _claim_states.get(claim_id)
    if not state:
        raise HTTPException(404, "Claim not found")
    try:
        get_supabase().table("review_queue").insert({
            "org_id": state.org_id,
            "claim_id": claim_id,
            "reason": state.review_reason,
            "details": {
                "denial_risk": state.denial_risk,
                "low_confidence_fields": state.low_confidence_fields,
            },
            "status": "open",
        }).execute()
    except Exception as e:
        print(f"[review-queue] insert error: {e}")
        raise HTTPException(500, "Failed to enqueue review")
    return {"queued": True}


@app.post("/claims/{claim_id}/resume")
async def resume_claim(claim_id: str, decision: ResumeDecision):
    state = _claim_states.get(claim_id)
    if not state:
        # Seeded claim — load from DB and construct minimal state
        try:
            row = get_supabase().table("claims").select("*").eq("id", claim_id).single().execute()
            if not row.data:
                raise HTTPException(404, "Claim not found")
            d = row.data
            org_row = get_supabase().table("orgs").select("id").limit(1).execute()
            org_id = d.get("org_id") or (org_row.data[0]["id"] if org_row.data else "")
            state = ClaimState(
                claim_id=claim_id,
                org_id=org_id,
                status=ClaimStatus(d.get("status", "needs_review")),
                payer_name=d.get("payer_name") or "",
                total_charge=d.get("total_charge") or 0.0,
                denial_risk=d.get("denial_risk") or 0.0,
                denial_risk_factors=d.get("denial_risk_factors") or [],
                needs_human_review=True,
                review_reason=f"Denial risk {d.get('denial_risk', 0):.0%} exceeds threshold",
            )
            _claim_states[claim_id] = state
            _claim_events.setdefault(claim_id, [])
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(404, f"Claim not found: {e}")

    if decision.approved:
        state.needs_human_review = False
        state.review_reason = ""
        # Set status to SCRUBBED so pipeline routes to submission next
        if "denial risk" in (state.review_reason or "").lower() or state.denial_risk > 0.5:
            state.status = ClaimStatus.SCRUBBED
        else:
            state.status = ClaimStatus.EXTRACTED
        state.status = ClaimStatus.SCRUBBED  # always go to submission after approval
        _claim_states[claim_id] = state
        _claim_events.setdefault(claim_id, [])

        async def _resume():
            try:
                from app.graph.pipeline import pipeline as _pipeline
                # Use a NEW thread_id so we don't hit the old interrupted checkpoint
                new_config = {
                    "configurable": {"thread_id": f"{claim_id}-resumed"},
                    "recursion_limit": 100
                }
                final_state_dict = await _pipeline.ainvoke(
                    state.model_dump(), config=new_config
                )
                final = ClaimState(**final_state_dict)
                _claim_states[claim_id] = final

                for ev in final.agent_events:
                    ev_dict = ev.model_dump()
                    existing = _claim_events.get(claim_id, [])
                    if ev_dict not in existing:
                        await push_event(claim_id, ev_dict)
                        await asyncio.sleep(0.3)

                try:
                    get_supabase().table("claims").update({
                        "status":              final.status.value,
                        "total_charge":        final.total_charge,
                        "denial_risk":         final.denial_risk,
                        "denial_risk_factors": final.denial_risk_factors,
                        "carc_code":           final.carc_code or None,
                        "rarc_code":           final.rarc_code or None,
                        "appeal_letter":       final.appeal_letter or None,
                        "cms1500_path":        final.cms1500_path or None,
                    }).eq("id", claim_id).execute()
                except Exception as db_err:
                    print(f"[resume] DB update error: {db_err}")
            except Exception as e:
                print(f"[resume] pipeline error: {e}")
                import traceback
                traceback.print_exc()
        asyncio.create_task(_resume())
    else:
        state.status = ClaimStatus.NEEDS_REVIEW
        state.needs_human_review = True
        _claim_states[claim_id] = state
        # On rejection: treat as payer denial and draft appeal letter
        async def _draft_rejection_appeal():
            try:
                from app.services.llm import text_call, MODEL_REASONING
                from app.services.resend_client import send_appeal_email
                from app.agents.submission import APPEAL_SYSTEM
                lines_text = "\n".join(
                    f"  - CPT {ln.cpt_code}: ICD-10 {', '.join(ln.icd10_codes)}, ${ln.charge:.2f}"
                    for ln in state.claim_lines
                ) if state.claim_lines else "  - See claim on file"
                appeal_prompt = f"""
Claim Reference: {state.claim_id[:8].upper()}
Patient: {state.patient_name}, DOB {state.patient_dob}
Provider: {state.provider_name} (NPI {state.provider_npi})
Date of Service: {state.date_of_service}
Payer: {state.payer_name}

Denial Reason: High denial risk ({state.denial_risk:.0%}) - claim flagged for medical necessity review.
Risk Factors: {', '.join(state.denial_risk_factors)}

Claim Lines:
{lines_text}

Draft a complete appeal letter arguing medical necessity."""
                appeal_text, _ = await text_call(
                    model=MODEL_REASONING,
                    system=APPEAL_SYSTEM,
                    user=appeal_prompt,
                )
                state.appeal_letter = appeal_text
                state.carc_code = "50"
                state.status = ClaimStatus.APPEALED
                _claim_states[claim_id] = state
                # Update SSE buffer
                _claim_events[claim_id].append({
                    "agent": "submission", "event": "completed",
                    "summary": f"Claim rejected by reviewer. Appeal letter drafted ({len(appeal_text.split())} words) citing medical necessity. Sending appeal email.",
                })
                await send_appeal_email(
                    claim_id=state.claim_id,
                    patient_name=state.patient_name,
                    payer_name=state.payer_name,
                    carc_code="50",
                    appeal_letter=appeal_text,
                )
                # Update DB
                try:
                    get_supabase().table("claims").update({
                        "status": "appealed",
                        "appeal_letter": appeal_text,
                        "carc_code": "50",
                    }).eq("id", claim_id).execute()
                except Exception as db_err:
                    print(f"[reject] DB update error: {db_err}")
                _claim_events[claim_id].append({
                    "agent": "system", "event": "done",
                    "summary": "Pipeline complete.",
                })
            except Exception as e:
                print(f"[reject] appeal draft error: {e}")
        asyncio.create_task(_draft_rejection_appeal())

    review_status = "approved" if decision.approved else "rejected"
    try:
        get_supabase().table("review_queue").update({
            "status": review_status,
        }).eq("claim_id", claim_id).eq("status", "open").execute()
    except Exception as e:
        print(f"[resume] review_queue update error: {e}")

    return {"resumed": True, "approved": decision.approved}
