from __future__ import annotations
from typing import Any
from pydantic import BaseModel, Field
from enum import Enum
import uuid


class ClaimStatus(str, Enum):
    DRAFT = "draft"
    EXTRACTED = "extracted"
    CODED = "coded"
    SCRUBBED = "scrubbed"
    NEEDS_REVIEW = "needs_review"
    SUBMITTED = "submitted"
    DENIED = "denied"
    APPEALED = "appealed"
    PAID = "paid"
    RECONCILED = "reconciled"


class AgentEvent(BaseModel):
    agent: str
    event: str          # started | decision | completed | escalated | error
    summary: str        # plain-English one-liner for the live feed
    payload: dict[str, Any] = Field(default_factory=dict)
    latency_ms: int = 0


class ClaimLine(BaseModel):
    line_no: int
    cpt_code: str
    modifiers: list[str] = Field(default_factory=list)
    icd10_codes: list[str]
    units: int = 1
    charge: float


class ClaimState(BaseModel):
    # Identity
    claim_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    org_id: str = ""
    document_storage_path: str = ""

    # Extraction
    patient_name: str = ""
    patient_dob: str = ""
    patient_member_id: str = ""
    payer_name: str = ""
    provider_name: str = ""
    provider_npi: str = ""
    date_of_service: str = ""
    claim_lines: list[ClaimLine] = Field(default_factory=list)
    extraction_confidence: dict[str, float] = Field(default_factory=dict)
    low_confidence_fields: list[str] = Field(default_factory=list)

    # Eligibility (271 response)
    eligibility_checked: bool = False
    eligibility_active: bool = False
    plan_name: str = ""
    copay: float = 0.0
    coinsurance: float = 0.0          # plan coinsurance rate, e.g. 0.20
    deductible_total: float = 0.0
    deductible_remaining: float = 0.0
    prior_auth_cpts: list[str] = Field(default_factory=list)   # CPTs payer requires auth for
    prior_auth_on_file: bool = False

    # Coding
    coding_issues: list[str] = Field(default_factory=list)
    coding_validated: bool = False

    # Claim / scrub
    total_charge: float = 0.0
    cms1500_path: str = ""          # storage path of generated PDF
    scrub_issues: list[str] = Field(default_factory=list)
    scrub_passed: bool = False

    # Denial risk
    denial_risk: float = 0.0
    denial_risk_factors: list[str] = Field(default_factory=list)

    # Fraud / anomaly
    anomaly_score: float = 0.0

    # Submission / adjudication
    clearinghouse_ref: str = ""
    submission_status: str = ""
    carc_code: str = ""
    rarc_code: str = ""
    denial_reason: str = ""
    rarc_reason: str = ""
    appeal_letter: str = ""
    adjudication: dict[str, Any] = Field(default_factory=dict)  # line-level payer decisions

    # Reconciliation (835/ERA)
    era: dict[str, Any] = Field(default_factory=dict)
    amount_paid: float = 0.0
    amount_expected: float = 0.0
    patient_responsibility: float = 0.0
    recon_variance: float = 0.0
    recon_discrepancy: bool = False
    recon_notes: str = ""

    # Pipeline control
    status: ClaimStatus = ClaimStatus.DRAFT
    needs_human_review: bool = False
    review_reason: str = ""

    # Trace log (drives live feed)
    agent_events: list[AgentEvent] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
