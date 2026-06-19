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
    """Persist an agent trace row — never raises, so a DB hiccup never kills the
    pipeline. The Supabase client call is blocking HTTP, so it runs in a worker
    thread to keep the event loop responsive under concurrent load."""
    row = {
        "claim_id":   claim_id,
        "org_id":     org_id,
        "agent":      agent,
        "event":      event,
        "summary":    summary,
        "payload":    payload,
        "latency_ms": latency_ms,
    }

    def _insert() -> None:
        try:
            get_supabase().table("agent_runs").insert(row).execute()
        except Exception as exc:
            print(f"[agent_runs log error] {exc}")

    await asyncio.to_thread(_insert)


async def log_audit_event(
    claim_id: str,
    org_id: str,
    actor_id: str,
    actor_name: str,
    actor_role: str,
    action: str,
    detail: str,
    metadata: dict | None = None,
) -> None:
    """Append an attributable, immutable audit row (who did what, to which claim).

    Best-effort and non-blocking: writes to the dedicated `audit_log` table if
    it exists (see migrations/0002_audit_log.sql) and no-ops otherwise, so the
    app works before the migration is applied. Never raises.
    """
    row = {
        "claim_id": claim_id or None,
        "org_id": org_id or None,
        "actor_id": actor_id or "anonymous",
        "actor_name": actor_name or "Unknown User",
        "actor_role": actor_role or "unknown",
        "action": action,
        "detail": detail,
        "metadata": metadata or {},
    }

    def _insert() -> None:
        try:
            get_supabase().table("audit_log").insert(row).execute()
        except Exception as exc:  # table may not exist yet — that's fine
            print(f"[audit_log] {action} skipped: {type(exc).__name__}")

    await asyncio.to_thread(_insert)


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


async def save_dispute_message(
    claim_id: str,
    org_id: str,
    sender: str,
    message_text: str,
    resend_email_id: str | None = None,
) -> None:
    """Insert a dispute thread row — best-effort, no-op if table missing."""
    row = {
        "claim_id": claim_id,
        "org_id": org_id or None,
        "sender": sender,
        "message_text": message_text,
        "resend_email_id": resend_email_id,
    }

    def _insert() -> None:
        try:
            get_supabase().table("dispute_threads").insert(row).execute()
        except Exception as exc:
            print(f"[dispute_threads] {sender} skipped: {type(exc).__name__}")

    await asyncio.to_thread(_insert)
