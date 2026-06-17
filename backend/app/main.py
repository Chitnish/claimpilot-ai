from __future__ import annotations
import asyncio, json, os, shutil, uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from dotenv import load_dotenv
load_dotenv()

from app.schemas.claim_state import ClaimLine, ClaimState, ClaimStatus
from app.graph.pipeline import pipeline
from app.services.corrections import build_corrected_claim
from app.services.security import Actor, get_actor, can_approve, DEMO_USERS
from app.services.supabase_client import (
    get_supabase,
    log_agent_event,
    log_audit_event,
    load_claim_state,
    save_claim_state,
)

UPLOAD_DIR = Path("data/synthetic/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# In-memory store for SSE streaming (durable history lives in agent_runs)
_claim_events: dict[str, list[dict]] = {}
_claim_states: dict[str, ClaimState] = {}
_claim_queues: dict[str, asyncio.Queue] = {}
_state_events_pushed: dict[str, int] = {}  # count of state.agent_events already streamed


async def push_event(claim_id: str, event: dict) -> None:
    """Push an agent event to both the SSE buffer and the live queue."""
    _claim_events.setdefault(claim_id, []).append(event)
    q = _claim_queues.get(claim_id)
    if q:
        await q.put(event)


class ResumeDecision(BaseModel):
    approved: bool
    reviewer_comment: str = ""


class CorrectionLine(BaseModel):
    line_no: int
    cpt_code: str
    modifiers: list[str] = []
    icd10_codes: list[str] = []
    units: int = 1
    charge: float = 0.0


class CorrectionRequest(BaseModel):
    reason: str
    frequency_code: str = "7"   # 7=replacement, 8=void
    claim_lines: list[CorrectionLine] | None = None


class CopilotChatMessage(BaseModel):
    role: str = "user"
    content: str


class CopilotChatRequest(BaseModel):
    messages: list[CopilotChatMessage]


def _get_state(claim_id: str) -> ClaimState | None:
    """In-memory state, or rehydrate the durable snapshot after a restart."""
    state = _claim_states.get(claim_id)
    if state is not None:
        return state
    snapshot = load_claim_state(claim_id)
    if snapshot is None:
        return None
    try:
        state = ClaimState(**snapshot)
    except Exception as exc:
        print(f"[state] rehydrate error for {claim_id}: {exc}")
        return None
    _claim_states[claim_id] = state
    _claim_events.setdefault(claim_id, [])
    _state_events_pushed.setdefault(claim_id, len(state.agent_events))
    return state


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify DB connection on startup
    try:
        get_supabase().table("orgs").select("id").limit(1).execute()
        print("[startup] Supabase connected OK")
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


@app.get("/auth/users")
async def list_demo_users():
    """Demo identity roster for the UI user switcher (Tier-1 demo, not auth)."""
    return {"users": DEMO_USERS}


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


@app.post("/claims/upload-batch")
async def upload_batch(files: list[UploadFile] = File(...)):
    """Accept multiple superbills, create one claim per file, run all in parallel."""
    if not files:
        raise HTTPException(400, "No files provided")

    results = []
    for file in files:
        claim_id = str(uuid.uuid4())
        suffix = Path(file.filename).suffix or ".png"
        dest = UPLOAD_DIR / f"{claim_id}{suffix}"
        with open(dest, "wb") as f:
            shutil.copyfileobj(file.file, f)

        try:
            row = get_supabase().table("orgs").select("id").limit(1).execute()
            org_id = row.data[0]["id"] if row.data else ""
        except Exception:
            org_id = ""

        try:
            get_supabase().table("claims").insert({
                "id": claim_id,
                "org_id": org_id,
                "encounter_id": None,
                "status": "draft",
            }).execute()
        except Exception as e:
            print(f"[batch-upload] claim insert error: {e}")

        initial_state = ClaimState(
            claim_id=claim_id,
            org_id=org_id,
            document_storage_path=str(dest),
        )
        _claim_events[claim_id] = []
        _claim_states[claim_id] = initial_state
        _claim_queues[claim_id] = asyncio.Queue()

        asyncio.create_task(_run_pipeline(claim_id, initial_state))

        results.append({
            "claim_id": claim_id,
            "filename": file.filename,
            "status": "processing",
        })

    return {"batch_size": len(results), "claims": results}


def _persist_claim_row(state: ClaimState) -> None:
    try:
        get_supabase().table("claims").update({
            "status":               state.status.value,
            "payer_name":           state.payer_name or None,
            "total_charge":         state.total_charge,
            "denial_risk":          state.denial_risk,
            "denial_risk_factors":  state.denial_risk_factors,
            "carc_code":            state.carc_code or None,
            "rarc_code":            state.rarc_code or None,
            "appeal_letter":        state.appeal_letter or None,
            "cms1500_path":         state.cms1500_path or None,
            "reviewer_comment":     state.reviewer_comment or None,
            "reviewer_decision":    state.reviewer_decision or None,
        }).eq("id", state.claim_id).execute()
    except Exception as e:
        print(f"[pipeline] claim update error: {e}")


async def _stream_pipeline(claim_id: str, state: ClaimState, thread_id: str) -> None:
    """Run the graph and push agent events to SSE the moment each node finishes."""
    pushed = _state_events_pushed.get(claim_id, 0)
    final_state = state
    try:
        config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 100}
        async for chunk in pipeline.astream(
            state.model_dump(), config=config, stream_mode="values"
        ):
            if not isinstance(chunk, dict):
                continue
            current = ClaimState(**chunk)
            final_state = current
            _claim_states[claim_id] = current
            events = current.agent_events
            while pushed < len(events):
                await push_event(claim_id, events[pushed].model_dump())
                pushed += 1
                _state_events_pushed[claim_id] = pushed
            # Snapshot after each node so a restart loses at most one step.
            asyncio.create_task(save_claim_state(current.model_dump()))

        _persist_claim_row(final_state)
        await save_claim_state(final_state.model_dump())
        # SSE generators detect paused/terminal state themselves.

    except Exception as exc:
        print(f"[pipeline] error for {claim_id}: {exc}")
        import traceback
        traceback.print_exc()
        await push_event(claim_id, {
            "agent": "system", "event": "error",
            "summary": f"Pipeline error: {str(exc)[:120]}",
        })


async def _run_pipeline(claim_id: str, state: ClaimState):
    await _stream_pipeline(claim_id, state, thread_id=claim_id)


@app.get("/claims/{claim_id}/events")
async def stream_events(claim_id: str):
    """SSE endpoint — streams agent events via queue for real-time delivery."""
    q: asyncio.Queue = asyncio.Queue()
    _claim_queues[claim_id] = q

    def _terminal_event(state: ClaimState | None) -> dict | None:
        if state is None:
            return None
        if state.status.value in ("reconciled", "paid") or (
            state.status.value in ("appealed", "denied") and state.anomaly_score > 0
        ):
            return {"agent": "system", "event": "done", "summary": "Pipeline complete."}
        if state.needs_human_review and state.status == ClaimStatus.NEEDS_REVIEW:
            return {"agent": "system", "event": "paused",
                    "summary": f"Pipeline paused for human review — {state.review_reason}"}
        return None

    async def generator():
        # Backfill: in-memory buffer first, else durable agent_runs history.
        buffered = _claim_events.get(claim_id)
        if buffered:
            for ev in buffered:
                yield {"data": json.dumps(ev)}
        else:
            for ev in _history_from_db(claim_id):
                yield {"data": json.dumps(ev)}
            # Rehydrate from the durable snapshot (post-restart); if there is
            # no snapshot, nothing live will arrive — close out.
            if _get_state(claim_id) is None:
                yield {"data": json.dumps({"agent": "system", "event": "done",
                                           "summary": "Showing recorded history."})}
                return

        terminal = _terminal_event(_claim_states.get(claim_id))
        if terminal:
            yield {"data": json.dumps(terminal)}
            return

        # Stream new events from the queue as the pipeline produces them.
        timeout_count = 0
        while timeout_count < 300:
            try:
                ev = await asyncio.wait_for(q.get(), timeout=1.0)
                yield {"data": json.dumps(ev)}
                timeout_count = 0
            except asyncio.TimeoutError:
                timeout_count += 1
            terminal = _terminal_event(_claim_states.get(claim_id))
            if terminal:
                yield {"data": json.dumps(terminal)}
                return

        # Cleanup
        _claim_queues.pop(claim_id, None)

    return EventSourceResponse(generator())


def _history_from_db(claim_id: str) -> list[dict]:
    """Durable agent activity from the agent_runs table (survives restarts)."""
    try:
        rows = (
            get_supabase()
            .table("agent_runs")
            .select("agent, event, summary, payload, latency_ms, created_at")
            .eq("claim_id", claim_id)
            .order("created_at", desc=False)
            .execute()
        )
        return [
            {
                "agent": r.get("agent", ""),
                "event": r.get("event", ""),
                "summary": r.get("summary", ""),
                "payload": r.get("payload") or {},
                "latency_ms": r.get("latency_ms") or 0,
                "created_at": r.get("created_at", ""),
            }
            for r in (rows.data or [])
        ]
    except Exception as e:
        print(f"[history] agent_runs query error: {e}")
        return []


@app.get("/claims/{claim_id}/history")
async def claim_history(claim_id: str):
    """Full durable agent activity trail for a claim."""
    return _history_from_db(claim_id)


@app.get("/claims/search")
async def search_claims(
    q: str = "",
    status: str = "",
    payer: str = "",
    limit: int = 20,
    offset: int = 0,
):
    """Paginated claims work list with text search and status/payer filters."""
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    try:
        query = (
            get_supabase()
            .table("claims")
            .select("*")
            .order("created_at", desc=True)
            .limit(500)
        )
        if status:
            query = query.eq("status", status)
        if payer:
            query = query.ilike("payer_name", f"%{payer}%")
        rows = query.execute().data or []

        if q:
            needle = q.strip().lower()
            rows = [
                r for r in rows
                if needle in str(r.get("id") or "").lower()
                or needle in (r.get("payer_name") or "").lower()
                or needle in (r.get("carc_code") or "").lower()
            ]

        payer_rows = (
            get_supabase().table("claims").select("payer_name").limit(500).execute()
        )
        payers = sorted({
            r["payer_name"] for r in (payer_rows.data or []) if r.get("payer_name")
        })

        return {
            "items": rows[offset:offset + limit],
            "total": len(rows),
            "limit": limit,
            "offset": offset,
            "facets": {"payers": payers},
        }
    except Exception as e:
        raise HTTPException(500, str(e))


@app.get("/analytics")
async def analytics():
    """Billing-department analytics computed over the claims table."""
    from collections import Counter
    from app.services.mock_payer import CARC_DESCRIPTIONS

    try:
        rows = (
            get_supabase()
            .table("claims")
            .select("status, payer_name, total_charge, denial_risk, carc_code, created_at")
            .order("created_at", desc=True)
            .limit(1000)
            .execute()
        ).data or []
    except Exception as e:
        raise HTTPException(500, str(e))

    total_claims = len(rows)
    total_billed = round(sum(r.get("total_charge") or 0.0 for r in rows), 2)

    status_counts = Counter((r.get("status") or "unknown") for r in rows)
    submitted_like = {"submitted", "denied", "appealed", "paid", "reconciled"}
    adjudicated = [r for r in rows if (r.get("status") or "") in submitted_like]
    denied = [r for r in adjudicated if (r.get("status") or "") in ("denied", "appealed")]
    denial_rate = round(len(denied) / len(adjudicated), 4) if adjudicated else 0.0

    risks = [r.get("denial_risk") for r in rows if r.get("denial_risk") is not None]
    avg_denial_risk = round(sum(risks) / len(risks), 4) if risks else 0.0

    carc_counter = Counter(
        (r.get("carc_code") or "") for r in rows if r.get("carc_code")
    )
    top_denial_reasons = [
        {
            "carc_code": code,
            "description": CARC_DESCRIPTIONS.get(code, "Unknown adjustment reason"),
            "count": count,
        }
        for code, count in carc_counter.most_common(8)
    ]

    payer_stats: dict[str, dict] = {}
    for r in rows:
        name = r.get("payer_name") or "Unknown"
        entry = payer_stats.setdefault(
            name, {"payer": name, "claims": 0, "billed": 0.0, "denied": 0}
        )
        entry["claims"] += 1
        entry["billed"] = round(entry["billed"] + (r.get("total_charge") or 0.0), 2)
        if (r.get("status") or "") in ("denied", "appealed"):
            entry["denied"] += 1
    payers = sorted(payer_stats.values(), key=lambda p: p["claims"], reverse=True)
    for p in payers:
        adjudicated_for_payer = [
            r for r in rows
            if (r.get("payer_name") or "Unknown") == p["payer"]
            and (r.get("status") or "") in submitted_like
        ]
        p["denial_rate"] = (
            round(p["denied"] / len(adjudicated_for_payer), 4)
            if adjudicated_for_payer else 0.0
        )

    daily_counter: dict[str, dict] = {}
    for r in rows:
        day = (r.get("created_at") or "")[:10]
        if not day:
            continue
        entry = daily_counter.setdefault(day, {"date": day, "claims": 0, "billed": 0.0})
        entry["claims"] += 1
        entry["billed"] = round(entry["billed"] + (r.get("total_charge") or 0.0), 2)
    daily_volume = sorted(daily_counter.values(), key=lambda d: d["date"])[-14:]

    high_risk_open = sum(
        1 for r in rows
        if (r.get("denial_risk") or 0) >= 0.6
        and (r.get("status") or "") in ("draft", "extracted", "coded", "scrubbed", "needs_review")
    )

    return {
        "total_claims": total_claims,
        "total_billed": total_billed,
        "denial_rate": denial_rate,
        "avg_denial_risk": avg_denial_risk,
        "high_risk_open": high_risk_open,
        "status_counts": dict(status_counts),
        "top_denial_reasons": top_denial_reasons,
        "payers": payers,
        "daily_volume": daily_volume,
    }


@app.get("/claims/{claim_id}")
async def get_claim(claim_id: str):
    state = _get_state(claim_id)
    if not state:
        # Seeded claims have a flat row but no full snapshot.
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
async def download_cms1500(
    claim_id: str,
    actor_id: str = "",
    actor_name: str = "",
    actor_role: str = "",
):
    state = _get_state(claim_id)
    if not state or not state.cms1500_path:
        raise HTTPException(404, "CMS-1500 not generated yet")
    # PHI-access audit: file downloads arrive as plain browser navigations, so
    # the acting user travels as query params rather than headers.
    await log_audit_event(
        claim_id, state.org_id, actor_id, actor_name, actor_role,
        "download_cms1500", f"Downloaded CMS-1500 PDF for claim {claim_id[:8]}",
    )
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
    state = _get_state(claim_id)
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
    state = _get_state(claim_id)
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
async def resume_claim(
    claim_id: str,
    decision: ResumeDecision,
    actor: Actor = Depends(get_actor),
):
    state = _get_state(claim_id)
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

    review_reason = state.review_reason or ""
    reason_lower = review_reason.lower()

    # Role-based access control: rejection is open to any role, but approving a
    # claim out of review (resuming the pipeline / accepting a payment) is gated
    # by approval authority so a junior biller cannot clear high-dollar,
    # high-risk, or financial-write-off work.
    if decision.approved:
        allowed, block_reason = can_approve(actor, state)
        if not allowed:
            await log_audit_event(
                claim_id, state.org_id, actor.id, actor.name, actor.role,
                "approve_denied", f"Approval blocked: {block_reason}",
                {"review_reason": review_reason, "total_charge": state.total_charge,
                 "denial_risk": state.denial_risk},
            )
            raise HTTPException(403, block_reason)

    state.reviewer_comment = decision.reviewer_comment
    state.reviewer_decision = "approved" if decision.approved else "rejected"
    state.reviewer_name = actor.name
    state.reviewer_role = actor.role
    _claim_states[claim_id] = state

    # Audit trail: every review decision is a durable agent_runs row AND an
    # attributable audit_log entry (who decided, with what authority).
    decision_summary = (
        f"{actor.label} {'APPROVED' if decision.approved else 'REJECTED'} claim — "
        f"reason under review: {review_reason or 'manual review'}."
        + (f" Notes: {decision.reviewer_comment}" if decision.reviewer_comment else "")
    )
    await log_agent_event(
        claim_id, state.org_id, "human_review", "decision",
        decision_summary,
        {"approved": decision.approved, "reason": review_reason,
         "actor_id": actor.id, "actor_name": actor.name, "actor_role": actor.role}, 0,
    )
    await log_audit_event(
        claim_id, state.org_id, actor.id, actor.name, actor.role,
        "approve_claim" if decision.approved else "reject_claim",
        decision_summary,
        {"review_reason": review_reason, "total_charge": state.total_charge,
         "denial_risk": state.denial_risk},
    )
    await push_event(claim_id, {
        "agent": "human_review", "event": "decision", "summary": decision_summary,
    })
    _state_events_pushed[claim_id] = len(state.agent_events)

    reviewer_fields = {
        "reviewer_comment": state.reviewer_comment or None,
        "reviewer_decision": state.reviewer_decision or None,
    }

    if decision.approved:
        state.needs_human_review = False
        state.review_reason = ""
        _claim_events.setdefault(claim_id, [])

        try:
            get_supabase().table("claims").update(reviewer_fields).eq("id", claim_id).execute()
        except Exception as e:
            print(f"[resume] approved reviewer update error: {e}")

        if "variance" in reason_lower:
            # Payment already received — approving accepts the posted payment.
            state.recon_discrepancy = False
            state.status = ClaimStatus.RECONCILED
            _claim_states[claim_id] = state
            _persist_claim_row(state)
            await save_claim_state(state.model_dump())
            summary = (
                f"Reviewer accepted posted payment of ${state.amount_paid:.2f} "
                f"(variance ${state.recon_variance:.2f} written off)."
            )
            await log_agent_event(claim_id, state.org_id, "reconciliation", "completed",
                                  summary, {"paid": state.amount_paid}, 0)
            await push_event(claim_id, {
                "agent": "reconciliation", "event": "completed", "summary": summary,
            })
        else:
            # Resume the pipeline. Extraction/eligibility holds restart from
            # coding; scrub blocks and denial-risk holds go straight to submission.
            if "low confidence" in reason_lower or "coverage terminated" in reason_lower:
                state.status = ClaimStatus.EXTRACTED
            else:
                state.status = ClaimStatus.SCRUBBED
            _claim_states[claim_id] = state
            # Fresh thread id so we don't collide with the interrupted checkpoint.
            asyncio.create_task(
                _stream_pipeline(claim_id, state, thread_id=f"{claim_id}-resumed-{uuid.uuid4().hex[:6]}")
            )
    else:
        state.status = ClaimStatus.NEEDS_REVIEW
        state.needs_human_review = True
        _claim_states[claim_id] = state

        try:
            get_supabase().table("claims").update(reviewer_fields).eq("id", claim_id).execute()
        except Exception as e:
            print(f"[resume] rejected reviewer update error: {e}")

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

Draft a complete appeal letter arguing medical necessity. Output plain text
only — no Markdown, no asterisks, no headers, no bullet points."""
                appeal_text, _ = await text_call(
                    model=MODEL_REASONING,
                    system=APPEAL_SYSTEM,
                    user=appeal_prompt,
                )
                from app.services.llm import strip_markdown
                appeal_text = strip_markdown(appeal_text)
                state.appeal_letter = appeal_text
                state.carc_code = "50"
                state.status = ClaimStatus.APPEALED
                _claim_states[claim_id] = state
                summary = (
                    f"Claim rejected by reviewer. Appeal letter drafted "
                    f"({len(appeal_text.split())} words) citing medical necessity. Sending appeal email."
                )
                await log_agent_event(claim_id, state.org_id, "submission", "completed",
                                      summary, {"carc": "50"}, 0)
                await push_event(claim_id, {
                    "agent": "submission", "event": "completed", "summary": summary,
                })
                await send_appeal_email(
                    claim_id=state.claim_id,
                    patient_name=state.patient_name,
                    payer_name=state.payer_name,
                    carc_code="50",
                    appeal_letter=appeal_text,
                )
                _persist_claim_row(state)
                await save_claim_state(state.model_dump())
                await push_event(claim_id, {
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


@app.post("/claims/{claim_id}/correct")
async def correct_claim(
    claim_id: str,
    body: CorrectionRequest,
    actor: Actor = Depends(get_actor),
):
    """
    File a corrected claim (837P frequency 7 replacement / 8 void) for a denied
    or appealed claim. Creates a NEW linked claim that references the original
    payer claim control number and re-runs the pipeline from coding so the fix
    is re-scrubbed and re-adjudicated — the correct workflow instead of a
    duplicate resubmission.
    """
    original = _get_state(claim_id)
    if not original:
        raise HTTPException(404, "Claim not found")

    correctable = (
        original.status in (ClaimStatus.DENIED, ClaimStatus.APPEALED)
        or bool(original.carc_code)
    )
    if not correctable:
        raise HTTPException(
            409, "Only denied or appealed claims can be corrected and resubmitted."
        )
    if original.corrected_by_claim_id:
        raise HTTPException(
            409,
            f"This claim was already corrected by {original.corrected_by_claim_id[:8]}.",
        )
    if not body.reason.strip():
        raise HTTPException(400, "A correction reason is required.")

    corrected_lines = None
    if body.claim_lines is not None:
        if not body.claim_lines:
            raise HTTPException(400, "A corrected claim must have at least one service line.")
        corrected_lines = [ClaimLine(**ln.model_dump()) for ln in body.claim_lines]

    new_state = build_corrected_claim(
        original,
        reason=body.reason,
        corrected_lines=corrected_lines,
        frequency_code=body.frequency_code,
    )
    new_id = new_state.claim_id

    # Base claims row uses only long-standing columns; the correction columns are
    # written separately so an un-applied migration cannot break persistence.
    try:
        get_supabase().table("claims").insert({
            "id": new_id,
            "org_id": new_state.org_id,
            "encounter_id": None,
            "status": new_state.status.value,
        }).execute()
    except Exception as e:
        print(f"[correct] claim insert error: {e}")
    try:
        get_supabase().table("claims").update({
            "frequency_code": new_state.frequency_code,
            "original_claim_id": new_state.original_claim_id,
            "correction_count": new_state.correction_count,
        }).eq("id", new_id).execute()
    except Exception as e:
        print(f"[correct] correction-column update skipped: {e}")

    _claim_events[new_id] = []
    _claim_states[new_id] = new_state
    _claim_queues[new_id] = asyncio.Queue()
    _state_events_pushed[new_id] = 0

    # Forward-link the original (superseded) claim and persist it.
    original.corrected_by_claim_id = new_id
    _claim_states[claim_id] = original
    try:
        get_supabase().table("claims").update({
            "corrected_by_claim_id": new_id,
        }).eq("id", claim_id).execute()
    except Exception as e:
        print(f"[correct] original forward-link update skipped: {e}")
    await save_claim_state(original.model_dump())

    # Activity trail on the original claim (so its live feed shows the action)…
    summary_old = (
        f"{actor.label} filed a corrected claim (frequency {new_state.frequency_code}) "
        f"as {new_id[:8]}. Reason: {new_state.correction_reason[:120]}"
    )
    await log_agent_event(
        claim_id, original.org_id, "correction", "decision", summary_old,
        {"corrected_by_claim_id": new_id, "frequency_code": new_state.frequency_code,
         "actor_id": actor.id, "actor_role": actor.role}, 0,
    )
    await push_event(claim_id, {
        "agent": "correction", "event": "decision", "summary": summary_old,
    })

    # …and the opening event on the new corrected claim.
    summary_new = (
        f"Corrected claim of {claim_id[:8]} "
        f"(original payer ref {new_state.original_payer_control_number or 'n/a'}). "
        f"{new_state.correction_reason[:120]}"
    )
    await log_agent_event(
        new_id, new_state.org_id, "correction", "started", summary_new,
        {"original_claim_id": claim_id, "frequency_code": new_state.frequency_code}, 0,
    )
    await log_audit_event(
        new_id, new_state.org_id, actor.id, actor.name, actor.role,
        "resubmit_corrected", summary_new,
        {"original_claim_id": claim_id, "frequency_code": new_state.frequency_code,
         "correction_count": new_state.correction_count},
    )

    asyncio.create_task(_run_pipeline(new_id, new_state))

    return {
        "claim_id": new_id,
        "original_claim_id": claim_id,
        "frequency_code": new_state.frequency_code,
        "status": new_state.status.value,
    }


@app.post("/claims/{claim_id}/chat")
async def claim_chat(
    claim_id: str,
    request: CopilotChatRequest,
    actor: Actor = Depends(get_actor),
):
    """Grounded review-copilot Q&A for a single claim's detail page."""
    from app.services.review_copilot import CopilotMessage, answer

    state = _get_state(claim_id)
    if not state:
        # Seeded claims have a flat row but no full snapshot — rehydrate minimally.
        try:
            row = get_supabase().table("claims").select("*").eq("id", claim_id).single().execute()
            if not row.data:
                raise HTTPException(404, "Claim not found")
            d = row.data
            state = ClaimState(
                claim_id=claim_id,
                org_id=d.get("org_id") or "",
                status=ClaimStatus(d.get("status", "draft")),
                payer_name=d.get("payer_name") or "",
                total_charge=d.get("total_charge") or 0.0,
                denial_risk=d.get("denial_risk") or 0.0,
                denial_risk_factors=d.get("denial_risk_factors") or [],
                carc_code=d.get("carc_code") or "",
                rarc_code=d.get("rarc_code") or "",
                appeal_letter=d.get("appeal_letter") or "",
            )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(404, f"Claim not found: {e}")

    messages = [
        CopilotMessage(role=m.role, content=m.content)
        for m in request.messages
        if m.content.strip()
    ]
    if not messages:
        raise HTTPException(400, "No message content provided")

    # PHI-access audit: the copilot exposes claim/patient data to the reviewer.
    await log_audit_event(
        claim_id, state.org_id, actor.id, actor.name, actor.role,
        "view_copilot", f"Opened Review Copilot Q&A on claim {claim_id[:8]}",
        {"question": messages[-1].content[:200]},
    )

    try:
        response, latency_ms = await answer(state, messages)
    except Exception as e:
        print(f"[chat] copilot error for {claim_id}: {type(e).__name__}")
        raise HTTPException(502, "Copilot is unavailable right now. Please try again.")

    return {
        "reply": response.reply,
        "citations": response.citations,
        "suggested_actions": response.suggested_actions,
        "latency_ms": latency_ms,
    }
