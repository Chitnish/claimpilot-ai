"""
Fraud & Anomaly Detection Agent.

Fuses two complementary views:
  - the single-claim Isolation Forest anomaly model (charge/line/dx/MUE shape), and
  - cross-claim / cross-provider statistical signals (charge outlier vs peers,
    duplicate/cloned claims, E/M upcoding skew, improbable service volume).
The final anomaly score is the stronger of the two so either view can raise a flag.
"""
from __future__ import annotations
import time
from app.schemas.claim_state import ClaimState, AgentEvent
from app.services.supabase_client import log_agent_event
from app.ml.predictor import score_anomaly
from app.services.fraud_signals import evaluate as evaluate_cross_claim

ANOMALY_THRESHOLD = 0.65


async def run(state: ClaimState) -> ClaimState:
    t0 = time.monotonic()

    state.agent_events.append(AgentEvent(
        agent="fraud", event="started",
        summary="Scanning claim for billing anomalies (single-claim model + cross-provider signals)...",
    ))

    model_score = score_anomaly(state.model_dump())
    cross = evaluate_cross_claim(state)
    cross_score = cross["score"]
    reasons = cross["reasons"]

    anomaly_score = max(model_score, cross_score)
    # Floor at 0.01: a zero score is the router's "not yet scored" sentinel.
    state.anomaly_score = max(anomaly_score, 0.01)
    state.anomaly_reasons = reasons

    latency_ms = int((time.monotonic() - t0) * 1000)

    if reasons:
        summary = (
            f"⚠ Fraud/abuse signals on this claim (score {anomaly_score:.0%}): "
            + " ".join(reasons[:2])
        )
    elif anomaly_score > ANOMALY_THRESHOLD:
        summary = (
            f"⚠ Anomaly detected — unusual billing shape score {anomaly_score:.0%} "
            f"(single-claim model). No cross-provider pattern matched."
        )
    else:
        summary = (
            f"No anomalies detected. Billing pattern within normal parameters "
            f"(model {model_score:.0%}, cross-claim {cross_score:.0%})."
        )

    payload = {
        "anomaly_score": anomaly_score,
        "model_score": model_score,
        "cross_claim_score": cross_score,
        "signals": cross["signals"],
        "reasons": reasons,
        "anomalous": anomaly_score > ANOMALY_THRESHOLD or bool(reasons),
    }
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
