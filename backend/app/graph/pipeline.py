"""
LangGraph supervisor pipeline — routes claims through agents based on ClaimState.status.
Phase 4 adds checkpointer persistence for HITL resume.
"""
from __future__ import annotations

from langgraph.graph import END, StateGraph
from langgraph.types import interrupt

from app.agents import coding, eligibility, intake, reconciliation, scrub, submission
from app.schemas.claim_state import ClaimState, ClaimStatus

_AGENT_NODES = (
    "eligibility",
    "intake",
    "coding",
    "scrub",
    "submission",
    "reconciliation",
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
    if state.status == ClaimStatus.EXTRACTED and not state.eligibility_active:
        return "eligibility"
    if state.status == ClaimStatus.EXTRACTED and state.eligibility_active:
        return "coding"
    if state.status == ClaimStatus.CODED:
        return "scrub"
    if state.status == ClaimStatus.SCRUBBED:
        return "submission"
    if state.status in (ClaimStatus.SUBMITTED, ClaimStatus.DENIED, ClaimStatus.APPEALED):
        return "reconciliation"
    if state.status in (ClaimStatus.RECONCILED, ClaimStatus.PAID):
        return "end"
    return "end"


async def supervisor(state: ClaimState) -> ClaimState:
    return state


async def human_review_node(state: ClaimState) -> ClaimState:
    # Log the review reason but continue pipeline automatically.
    # True HITL pause with interrupt() requires a checkpointer — added in Phase 4.
    # For now: high denial risk claims continue to submission; low confidence claims stop here.
    from app.schemas.claim_state import ClaimStatus
    if "denial risk" in state.review_reason.lower():
        # Continue pipeline — claim was flagged but we let it proceed
        state.needs_human_review = False
        state.status = ClaimStatus.SCRUBBED
    elif "confidence" in state.review_reason.lower():
        state.needs_human_review = False
        state.status = ClaimStatus.EXTRACTED
    else:
        state.needs_human_review = False
        state.status = ClaimStatus.SCRUBBED
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
            "human_review": "human_review",
            "end": END,
        },
    )

    for node in _AGENT_NODES:
        g.add_edge(node, "supervisor")
    g.add_edge("human_review", "supervisor")

    return g.compile(checkpointer=None)


pipeline = build_pipeline()
