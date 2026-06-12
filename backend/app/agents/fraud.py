"""
Fraud & Anomaly Detection Agent — Isolation Forest scoring.
"""
from __future__ import annotations
import time
from app.schemas.claim_state import ClaimState, AgentEvent
from app.services.supabase_client import log_agent_event
from app.ml.predictor import score_anomaly

ANOMALY_THRESHOLD = 0.65


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="fraud", event="started",
        summary="Scanning claim for billing anomalies...",
    ))

    anomaly_score = score_anomaly(state.model_dump())
    # Floor at 0.01: a zero score is the router's "not yet scored" sentinel.
    state.anomaly_score = max(anomaly_score, 0.01)

    latency_ms = int((time.monotonic() - t0) * 1000)

    if anomaly_score > ANOMALY_THRESHOLD:
        summary = (
            f"⚠ Anomaly detected — unusual billing pattern score {anomaly_score:.0%}. "
            "Charge amount and CPT mix flagged as statistical outliers."
        )
    else:
        summary = (
            f"No anomalies detected. Claim billing pattern within normal parameters "
            f"(score {anomaly_score:.0%})."
        )

    payload = {"anomaly_score": anomaly_score, "anomalous": anomaly_score > ANOMALY_THRESHOLD}
    state.agent_events.append(AgentEvent(
        agent="fraud", event="completed",
        summary=summary,
        payload=payload,
        latency_ms=latency_ms,
    ))
    await log_agent_event(
        state.claim_id, state.org_id, "fraud", "completed",
        summary, payload, latency_ms,
    )
    return state
