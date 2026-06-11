from __future__ import annotations
import asyncio, json, os, shutil, uuid
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sse_starlette.sse import EventSourceResponse

from dotenv import load_dotenv
load_dotenv()

from app.schemas.claim_state import ClaimState
from app.graph.pipeline import pipeline
from app.services.supabase_client import get_supabase

UPLOAD_DIR = Path("data/synthetic/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# In-memory store for SSE streaming (replaced by DB pub/sub in Phase 3)
_claim_events: dict[str, list[dict]] = {}
_claim_states: dict[str, ClaimState] = {}


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

    # Run pipeline in background
    asyncio.create_task(_run_pipeline(claim_id, initial_state))

    return {"claim_id": claim_id, "status": "processing"}


async def _run_pipeline(claim_id: str, state: ClaimState):
    try:
        final_state_dict = await pipeline.ainvoke(state.model_dump())
        final_state = ClaimState(**final_state_dict)
        _claim_states[claim_id] = final_state

        # Push all events to SSE buffer
        for ev in final_state.agent_events:
            _claim_events[claim_id].append(ev.model_dump())

        # Update claim row in DB
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
        _claim_events[claim_id].append({
            "agent": "system", "event": "error",
            "summary": f"Pipeline error: {str(exc)[:120]}",
        })


@app.get("/claims/{claim_id}/events")
async def stream_events(claim_id: str):
    """SSE endpoint — streams agent events as they are appended."""
    async def generator():
        sent = 0
        for _ in range(120):  # 2-min timeout
            events = _claim_events.get(claim_id, [])
            while sent < len(events):
                yield {"data": json.dumps(events[sent])}
                sent += 1
            state = _claim_states.get(claim_id)
            if state and state.status.value in (
                "reconciled", "appealed", "needs_review", "paid"
            ):
                yield {"data": json.dumps({"agent": "system", "event": "done",
                                           "summary": "Pipeline complete."})}
                return
            await asyncio.sleep(1)

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
