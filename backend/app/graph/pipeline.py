"""
LangGraph supervisor pipeline — routes claims through agents based on ClaimState.status.
Phase 4 adds checkpointer persistence for HITL resume.
"""
from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from app.agents import coding, eligibility, fraud, intake, reconciliation, scrub, submission
from app.schemas.claim_state import ClaimState, ClaimStatus

_checkpointer = MemorySaver()

_AGENT_NODES = (
    "eligibility",
    "intake",
    "coding",
    "scrub",
    "submission",
    "reconciliation",
    "fraud",
)


def route(state: ClaimState) -> str:
    if state.errors:
        return "end"
    if state.status == ClaimStatus.NEEDS_REVIEW and not state.needs_human_review:
        return "submission"
    if state.needs_human_review and state.status == ClaimStatus.NEEDS_REVIEW:
        return "human_review"
    # Run intake first if we have a document but no extracted lines yet
    if state.status == ClaimStatus.DRAFT and state.document_storage_path and not state.claim_lines:
        return "intake"
    # Then eligibility
    if state.status == ClaimStatus.DRAFT:
        return "eligibility"
    if state.status == ClaimStatus.EXTRACTED and not state.eligibility_checked:
        return "eligibility"
    if state.status == ClaimStatus.EXTRACTED and state.eligibility_checked:
        return "coding"
    if state.status == ClaimStatus.CODED:
        return "scrub"
    if state.status == ClaimStatus.SCRUBBED:
        return "submission"
    # Reconcile once — state.era is the sentinel that the 835 has been posted.
    if state.status in (ClaimStatus.SUBMITTED, ClaimStatus.DENIED, ClaimStatus.APPEALED) and not state.era:
        return "reconciliation"
    terminal = (ClaimStatus.RECONCILED, ClaimStatus.PAID, ClaimStatus.DENIED, ClaimStatus.APPEALED)
    if state.status in terminal and state.anomaly_score == 0.0:
        return "fraud"
    return "end"


async def supervisor(state: ClaimState) -> ClaimState:
    return state


async def human_review_node(state: ClaimState) -> ClaimState:
    # Only interrupt if genuinely waiting for human — skip if already approved
    if state.needs_human_review:
        interrupt({"reason": state.review_reason, "claim_id": state.claim_id})
    # Execution resumes here after /claims/{id}/resume is called
    if not state.needs_human_review:
        if "denial risk" in state.review_reason.lower():
            state.status = ClaimStatus.SCRUBBED
        else:
            state.status = ClaimStatus.EXTRACTED
    return state


def build_pipeline():
    g = StateGraph(ClaimState)

    g.add_node("supervisor", supervisor)
    g.add_node("eligibility", eligibility.run)
    g.add_node("intake", intake.run)
    g.add_node("coding", coding.run)
    g.add_node("scrub", scrub.run)
    g.add_node("submission", submission.run)
    g.add_node("reconciliation", reconciliation.run)
    g.add_node("fraud", fraud.run)
    g.add_node("human_review", human_review_node)

    g.set_entry_point("supervisor")

    g.add_conditional_edges(
        "supervisor",
        route,
        {
            "eligibility": "eligibility",
            "intake": "intake",
            "coding": "coding",
            "scrub": "scrub",
            "submission": "submission",
            "reconciliation": "reconciliation",
            "fraud": "fraud",
            "human_review": "human_review",
            "end": END,
        },
    )

    for node in _AGENT_NODES:
        g.add_edge(node, "supervisor")
    g.add_edge("human_review", "supervisor")

    return g.compile(checkpointer=_checkpointer)


pipeline = build_pipeline()
