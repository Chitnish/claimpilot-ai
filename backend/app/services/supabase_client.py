import asyncio
import json
import os

from supabase import create_client, Client

_client: Client | None = None

# Full ClaimState snapshots live in Storage (REST) rather than a Postgres
# table because direct DB/DDL access is unavailable from this network.
# backend/migrations/0001_claim_states.sql holds the table version for when
# a SQL connection exists; swapping these helpers over is a two-line change.
_STATE_BUCKET = "documents"
_STATE_PREFIX = "claim-states"


def get_supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SERVICE_KEY"],
        )
    return _client


async def log_agent_event(
    claim_id: str,
    org_id: str,
    agent: str,
    event: str,
    summary: str,
    payload: dict,
    latency_ms: int = 0,
) -> None:
    """Persist an agent trace row — never raises, so a DB hiccup never kills the pipeline."""
    try:
        get_supabase().table("agent_runs").insert({
            "claim_id":   claim_id,
            "org_id":     org_id,
            "agent":      agent,
            "event":      event,
            "summary":    summary,
            "payload":    payload,
            "latency_ms": latency_ms,
        }).execute()
    except Exception as exc:
        print(f"[agent_runs log error] {exc}")


def _state_path(claim_id: str) -> str:
    return f"{_STATE_PREFIX}/{claim_id}.json"


def save_claim_state_sync(state_dict: dict) -> None:
    """Persist a full ClaimState snapshot to Storage. Never raises."""
    claim_id = state_dict.get("claim_id", "")
    if not claim_id:
        return
    try:
        payload = json.dumps(state_dict, default=str).encode("utf-8")
        get_supabase().storage.from_(_STATE_BUCKET).upload(
            _state_path(claim_id),
            payload,
            file_options={"content-type": "application/json", "upsert": "true"},
        )
    except Exception as exc:
        print(f"[claim_state save error] {exc}")


async def save_claim_state(state_dict: dict) -> None:
    """Async wrapper — storage upload is a blocking HTTP call."""
    await asyncio.to_thread(save_claim_state_sync, state_dict)


def load_claim_state(claim_id: str) -> dict | None:
    """Load a persisted ClaimState snapshot, or None if absent."""
    try:
        raw = get_supabase().storage.from_(_STATE_BUCKET).download(_state_path(claim_id))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None
