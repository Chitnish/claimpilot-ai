"""
Reviewer identity and role-based access control (Tier-1 demo layer).

This is a lightweight identity layer for the demo: the acting user and role
arrive as request headers (X-Actor-Id / X-Actor-Name / X-Actor-Role) chosen
from a fixed roster in the UI. A real deployment replaces this with an SSO/
IdP integration and DB-backed users + Postgres RLS (Tier 2) — the call sites
(`get_actor`, `can_approve`) stay the same.

Design goals:
  - Never break the existing demo: a missing/invalid role defaults to manager,
    so unauthenticated calls retain today's behavior.
  - Real billing-department hierarchy: billers can clear routine work but
    high-dollar / high-risk / financial write-offs require a supervisor.
  - Every privileged action is attributable to a named actor for audit.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

from fastapi import Header

from app.schemas.claim_state import ClaimState

ROLE_BILLER = "biller"
ROLE_SUPERVISOR = "supervisor"
ROLE_MANAGER = "manager"

VALID_ROLES = {ROLE_BILLER, ROLE_SUPERVISOR, ROLE_MANAGER}
ELEVATED_ROLES = {ROLE_SUPERVISOR, ROLE_MANAGER}

# Fixed demo roster surfaced in the UI user switcher. No credentials — this is
# a demo identity layer, not authentication.
DEMO_USERS: list[dict[str, str]] = [
    {"id": "u-biller", "name": "Jordan Lee", "role": ROLE_BILLER},
    {"id": "u-supervisor", "name": "Sam Rivera", "role": ROLE_SUPERVISOR},
    {"id": "u-manager", "name": "Alex Morgan", "role": ROLE_MANAGER},
]

# Approval limits for the entry-level role. Above these, a supervisor/manager
# must sign off — mirrors real billing-office approval thresholds.
BILLER_APPROVAL_MAX_CHARGE = float(os.getenv("BILLER_APPROVAL_MAX_CHARGE", "500"))
BILLER_APPROVAL_MAX_RISK = float(os.getenv("BILLER_APPROVAL_MAX_RISK", "0.75"))


@dataclass(frozen=True)
class Actor:
    id: str
    name: str
    role: str

    @property
    def label(self) -> str:
        return f"{self.name} ({self.role})"


def get_actor(
    x_actor_id: str | None = Header(default=None),
    x_actor_name: str | None = Header(default=None),
    x_actor_role: str | None = Header(default=None),
) -> Actor:
    """FastAPI dependency: resolve the acting user from request headers.

    Falls back to a manager identity so existing/headerless calls keep working.
    """
    role = (x_actor_role or "").strip().lower()
    if role not in VALID_ROLES:
        role = ROLE_MANAGER
    name = (x_actor_name or "").strip() or "Unknown User"
    actor_id = (x_actor_id or "").strip() or "anonymous"
    return Actor(id=actor_id, name=name, role=role)


def can_approve(actor: Actor, state: ClaimState) -> tuple[bool, str]:
    """Whether `actor` may APPROVE this claim out of review.

    Returns (allowed, reason_if_blocked). Rejection is always permitted for any
    role; only approval (which resumes/posts money) is gated.
    """
    if actor.role in ELEVATED_ROLES:
        return True, ""

    reason = (state.review_reason or "").lower()
    if "variance" in reason:
        return (
            False,
            "Payment-variance write-offs require a supervisor or manager to approve.",
        )
    if (state.total_charge or 0.0) > BILLER_APPROVAL_MAX_CHARGE:
        return (
            False,
            f"Claims over ${BILLER_APPROVAL_MAX_CHARGE:,.0f} require a supervisor or manager to approve.",
        )
    if (state.denial_risk or 0.0) >= BILLER_APPROVAL_MAX_RISK:
        return (
            False,
            f"Claims at or above {BILLER_APPROVAL_MAX_RISK:.0%} denial risk require a supervisor or manager to approve.",
        )
    return True, ""
