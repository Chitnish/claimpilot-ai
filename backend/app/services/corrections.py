"""
Corrected-claim resubmission.

When a payer denies a claim for a fixable reason (wrong/missing modifier,
unsupported diagnosis linkage, transposed code, etc.), the billing office does
NOT file a brand-new claim — that trips the duplicate edit (CARC 18). Instead it
files a *corrected* claim: 837P frequency type code 7 (replacement) referencing
the original payer claim control number, or 8 (void). CMS-1500 box 22 carries the
resubmission code and original reference number.

This module builds the corrected ClaimState from the original, applies the
reviewer's line edits, resets all adjudication/payment state, and links the new
claim back to its parent so the lineage is auditable.
"""
from __future__ import annotations

import uuid

from app.schemas.claim_state import ClaimLine, ClaimState, ClaimStatus

FREQ_REPLACEMENT = "7"
FREQ_VOID = "8"


def build_corrected_claim(
    original: ClaimState,
    *,
    reason: str,
    corrected_lines: list[ClaimLine] | None = None,
    frequency_code: str = FREQ_REPLACEMENT,
) -> ClaimState:
    """
    Produce a fresh ClaimState representing a corrected resubmission of
    `original`. Patient/provider/coverage context is carried forward; all
    adjudication, payment, scrub, risk, and review state is reset so the claim
    re-runs cleanly through coding → scrub → submission → reconciliation.

    The original payer claim control number is taken from the original's
    clearinghouse reference (the value a payer would have returned on the 277/835
    and that box 22 must echo).
    """
    if frequency_code not in (FREQ_REPLACEMENT, FREQ_VOID):
        frequency_code = FREQ_REPLACEMENT

    lines = corrected_lines if corrected_lines is not None else [
        ln.model_copy(deep=True) for ln in original.claim_lines
    ]

    new_claim_id = str(uuid.uuid4())
    total_charge = round(sum(ln.charge for ln in lines), 2)

    return ClaimState(
        claim_id=new_claim_id,
        org_id=original.org_id,
        document_storage_path=original.document_storage_path,

        # Carry forward extracted demographics / clinical context.
        patient_name=original.patient_name,
        patient_dob=original.patient_dob,
        patient_member_id=original.patient_member_id,
        payer_name=original.payer_name,
        provider_name=original.provider_name,
        provider_npi=original.provider_npi,
        date_of_service=original.date_of_service,
        claim_lines=lines,
        total_charge=total_charge,

        # Carry forward eligibility so the corrected claim does not need a fresh
        # 270/271 round trip (same member, same coverage as of the DOS).
        eligibility_checked=original.eligibility_checked,
        eligibility_active=original.eligibility_active,
        plan_name=original.plan_name,
        copay=original.copay,
        coinsurance=original.coinsurance,
        deductible_total=original.deductible_total,
        deductible_remaining=original.deductible_remaining,
        prior_auth_cpts=list(original.prior_auth_cpts),
        prior_auth_on_file=original.prior_auth_on_file,

        # Corrected-claim lineage (box 22 / frequency).
        frequency_code=frequency_code,
        original_claim_id=original.claim_id,
        original_payer_control_number=original.clearinghouse_ref,
        correction_count=original.correction_count + 1,
        correction_reason=reason.strip(),

        # Re-enter the pipeline at coding so the corrected lines are re-scrubbed
        # and re-adjudicated deterministically.
        status=ClaimStatus.CODED,
    )
