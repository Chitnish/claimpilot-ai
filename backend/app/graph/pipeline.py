"""
Linear LangGraph pipeline for Phase 2.
Phase 3 adds supervisor branching + HITL interrupts.
"""
from __future__ import annotations
from langgraph.graph import StateGraph, END
from app.schemas.claim_state import ClaimState
from app.agents import intake, coding, scrub, submission, reconciliation


def build_pipeline():
    g = StateGraph(ClaimState)

    g.add_node("intake",          intake.run)
    g.add_node("coding",          coding.run)
    g.add_node("scrub",           scrub.run)
    g.add_node("submission",      submission.run)
    g.add_node("reconciliation",  reconciliation.run)

    g.set_entry_point("intake")
    g.add_edge("intake",         "coding")
    g.add_edge("coding",         "scrub")
    g.add_edge("scrub",          "submission")
    g.add_edge("submission",     "reconciliation")
    g.add_edge("reconciliation", END)

    return g.compile()


pipeline = build_pipeline()
