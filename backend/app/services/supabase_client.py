import os
from supabase import create_client, Client

_client: Client | None = None


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
