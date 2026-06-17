"""
Simulated payer & clearinghouse with deterministic, content-driven adjudication.

Simulates:
  - Eligibility 270/271 with plan variety, benefits, and prior-auth requirements
  - Clearinghouse claim submission (837P analogue)
  - Line-level payer adjudication driven by actual claim content — every denial
    has a cause that a scrubber (or the denial-risk model) could have predicted
  - 835/ERA remittance with CO / PR / OA group codes and a real patient
    responsibility split (PR-1 deductible, PR-2 coinsurance, PR-3 copay)

All randomness is derived from stable hashes of claim identifiers so the same
claim always adjudicates the same way (demo-reproducible, model-learnable).
"""
from __future__ import annotations

import hashlib
import uuid
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP

from app.schemas.claim_state import ClaimState

# ──────────────────────────────────────────────────────────────────────────
# CARC / RARC catalogs (real public code meanings)
# ──────────────────────────────────────────────────────────────────────────

# Real, public Washington Publishing Company (X12) CARC meanings. A production
# remittance engine consumes the full ~400-code list with quarterly updates;
# this curated set covers every denial/adjustment this engine can produce plus
# common neighbors a billing specialist routinely sees.
CARC_DESCRIPTIONS: dict[str, str] = {
    "1":   "Deductible amount.",
    "2":   "Coinsurance amount.",
    "3":   "Co-payment amount.",
    "4":   "The procedure code is inconsistent with the modifier used, or a required modifier is missing.",
    "6":   "The procedure/revenue code is inconsistent with the patient's age.",
    "9":   "The diagnosis is inconsistent with the patient's age.",
    "11":  "The diagnosis is inconsistent with the procedure.",
    "16":  "Claim/service lacks information or has submission/billing error(s) which is needed for adjudication.",
    "18":  "Exact duplicate claim/service.",
    "22":  "This care may be covered by another payer per coordination of benefits.",
    "23":  "The impact of prior payer(s) adjudication including payments and/or adjustments.",
    "26":  "Expenses incurred prior to coverage.",
    "27":  "Expenses incurred after coverage terminated.",
    "29":  "The time limit for filing has expired.",
    "45":  "Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement.",
    "50":  "These are non-covered services because this is not deemed a 'medical necessity' by the payer.",
    "58":  "Treatment was deemed by the payer to have been rendered in an inappropriate or invalid place of service.",
    "59":  "Processed based on multiple or concurrent procedure rules.",
    "96":  "Non-covered charge(s).",
    "97":  "The benefit for this service is included in the payment/allowance for another service/procedure that has already been adjudicated.",
    "109": "Claim/service not covered by this payer/contractor. You must send the claim/service to the correct payer/contractor.",
    "119": "Benefit maximum for this time period or occurrence has been reached.",
    "140": "Patient/Insured health identification number and name do not match.",
    "146": "Diagnosis was invalid for the date(s) of service reported.",
    "151": "Payment adjusted because the payer deems the information submitted does not support this many/frequency of services.",
    "182": "Procedure modifier was invalid on the date of service.",
    "197": "Precertification/authorization/notification/pre-treatment absent.",
    "204": "This service/equipment/drug is not covered under the patient's current benefit plan.",
    "B7":  "This provider was not certified/eligible to be paid for this procedure/service on this date of service.",
    "B15": "This service/procedure requires that a qualifying service/procedure be received and covered.",
}

# Real, public X12 RARC meanings (remark codes that accompany a CARC).
RARC_DESCRIPTIONS: dict[str, str] = {
    "M15":   "Separately billed services/tests have been bundled as they are considered components of the same procedure. Separate payment is not allowed.",
    "M51":   "Missing/incomplete/invalid procedure code(s).",
    "M76":   "Missing/incomplete/invalid diagnosis or condition.",
    "M80":   "Not covered when performed during the same session/date as a previously processed service for the patient.",
    "MA61":  "Missing/incomplete/invalid social security number or health insurance claim number.",
    "MA63":  "Missing/incomplete/invalid principal diagnosis.",
    "MA130": "Your claim contains incomplete and/or invalid information, and no appeal rights are afforded because the claim is unprocessable.",
    "N19":   "Procedure code incidental to primary procedure.",
    "N20":   "Service not payable with other service rendered on the same date.",
    "N30":   "Patient ineligible for this service.",
    "N56":   "Procedure code billed is not correct/valid for the services billed or the date of service billed.",
    "N115":  "This decision was based on a Local Coverage Determination (LCD).",
    "N130":  "Consult plan benefit documents/guidelines for information about restrictions for this service.",
    "N211":  "Alert: You may not appeal this decision.",
    "N290":  "Missing/incomplete/invalid rendering provider primary identifier.",
    "N362":  "The number of Days or Units of Service exceeds our acceptable maximum.",
    "N386":  "This decision was based on a National Coverage Determination (NCD).",
    "N522":  "Duplicate of a claim processed, or to be processed, as a crossover claim.",
}

# ──────────────────────────────────────────────────────────────────────────
# Payer configuration — fee schedules, filing limits, auth rules, plans
# ──────────────────────────────────────────────────────────────────────────

# Commercial allowed amounts (roughly 1.2-1.5x Medicare). Billed charges from
# the synthetic superbills are intentionally above these, producing a CO-45
# contractual adjustment on every paid line, as in real remits.
FEE_SCHEDULE: dict[str, Decimal] = {
    "99213": Decimal("120.00"),
    "99214": Decimal("168.00"),
    "99215": Decimal("232.00"),
    "93000": Decimal("38.00"),
    "85025": Decimal("16.50"),
    "80053": Decimal("22.00"),
    "80048": Decimal("17.00"),
    "80061": Decimal("19.00"),
    "83036": Decimal("13.00"),
    "81002": Decimal("4.00"),
    "36415": Decimal("3.00"),
    "90471": Decimal("25.00"),
    "99000": Decimal("9.00"),
}
DEFAULT_ALLOWED_RATIO = Decimal("0.72")   # for CPTs not on the schedule

# Medically Unlikely Edits — max units of service per day per HCPCS/CPT. Values
# reflect the order of magnitude of published CMS MUE values for these common
# outpatient codes (single E/M per day; one panel/test per day; venipuncture
# allows a small number per encounter).
MUE_LIMITS: dict[str, int] = {
    "99211": 1, "99212": 1, "99213": 1, "99214": 1, "99215": 1,
    "99202": 1, "99203": 1, "99204": 1, "99205": 1,
    "93000": 1, "85025": 1, "80053": 1, "80048": 1, "80061": 1,
    "83036": 1, "81002": 1, "90471": 1, "99000": 1,
    "36415": 2,
}

# Diagnoses (by ICD-10 prefix) that support medical necessity for each CPT under
# LCD/NCD-style coverage policy. E/M visits and routine venipuncture accept any
# diagnosis; diagnostic tests must link to a covered indication.
MEDICAL_NECESSITY: dict[str, tuple[str, ...]] = {
    "93000": ("I", "R00", "R06", "R07", "E11"),            # ECG: cardiac/related
    "80053": ("E11", "E78", "I10", "N18", "K76", "R79"),    # CMP: metabolic
    "85025": ("D5", "D6", "D7", "R50", "R53", "J", "E11"),  # CBC: anemia/infection
    "80061": ("E78", "E11", "E10", "I10", "I25", "Z13.220"),  # Lipid panel
    "83036": ("E11", "E10", "E13", "R73", "O24", "Z13.1"),    # Hemoglobin A1C
    "81002": ("N39", "R30", "R31", "R35", "N30", "N18"),      # Urinalysis
}

# NCCI procedure-to-procedure (PTP) and Medicare status-indicator bundling.
# Each entry: a column-2 code that is not separately payable when a column-1
# code is present on the same claim.
#   modifier_indicator "0" -> no modifier can bypass the edit (never separable)
#   modifier_indicator "1" -> a distinct-service modifier (59/XU) may bypass
# `bypass` is the modifier that overrides a "1" edit, or None for a "0" edit.
NCCI_PAIRS: list[dict] = [
    # Specimen handling/conveyance (99000) carries Medicare status indicator B
    # (bundled): it is never separately payable, with or without a modifier.
    {
        "column1": ("99211", "99212", "99213", "99214", "99215",
                    "99202", "99203", "99204", "99205"),
        "column2": "99000",
        "modifier_indicator": "0",
        "bypass": None,
        "carc": "97",
        "rarc": "N19",
        "rationale": "Medicare status B (bundled) — not separately reimbursable.",
    },
    # Panel within a panel: the Comprehensive Metabolic Panel (80053) includes
    # all Basic Metabolic Panel (80048) analytes; reporting both unbundles a
    # comprehensive panel (AMA CPT panel definitions / NCCI lab edits).
    {
        "column1": ("80053",),
        "column2": "80048",
        "modifier_indicator": "1",
        "bypass": "59",
        "carc": "97",
        "rarc": "M15",
        "rationale": "CMP (80053) includes all BMP (80048) components.",
    },
]

# An E/M visit billed same-day as one of these procedures requires modifier 25
# on the E/M line to attest it was significant & separately identifiable. Per
# CPT/CMS guidance modifier 25 attaches an E/M to a same-day procedure with a
# global period; immunization administration (90471, XXX global) is the classic
# example most payers enforce. (A diagnostic test such as an ECG does NOT bundle
# the E/M and does not require modifier 25.)
PROCEDURES_REQUIRING_EM_MOD25 = ("90471",)
E_AND_M_CODES = ("99202", "99203", "99204", "99205", "99211", "99212", "99213", "99214", "99215")

PAYER_RULES: dict[str, dict] = {
    "bluecross": {"filing_days": 365, "fee_factor": Decimal("1.10"), "auth_cpts": ()},
    "aetna":     {"filing_days": 120, "fee_factor": Decimal("1.00"), "auth_cpts": ("93000",)},
    "united":    {"filing_days": 90,  "fee_factor": Decimal("0.95"), "auth_cpts": ("93000",)},
    "cigna":     {"filing_days": 90,  "fee_factor": Decimal("1.05"), "auth_cpts": ()},
    "humana":    {"filing_days": 180, "fee_factor": Decimal("0.92"), "auth_cpts": ("93000", "80053")},
}
DEFAULT_PAYER_RULES = {"filing_days": 180, "fee_factor": Decimal("1.00"), "auth_cpts": ()}

PLAN_TIERS: list[dict] = [
    {"plan_suffix": "PPO Gold",   "copay": Decimal("30.00"), "coinsurance": Decimal("0.10"), "deductible_total": Decimal("500.00")},
    {"plan_suffix": "PPO Silver", "copay": Decimal("45.00"), "coinsurance": Decimal("0.20"), "deductible_total": Decimal("1500.00")},
    {"plan_suffix": "HMO Value",  "copay": Decimal("60.00"), "coinsurance": Decimal("0.30"), "deductible_total": Decimal("3000.00")},
]

# In-process duplicate-claim registry: (member_id, dos, cpt) → claim_id.
_SUBMISSION_REGISTRY: dict[tuple[str, str, str], str] = {}


def _stable_pct(*parts: str) -> float:
    """Deterministic pseudo-random float in [0, 1) from identifier strings."""
    digest = hashlib.md5("|".join(parts).encode()).hexdigest()
    return int(digest[:8], 16) / 0xFFFFFFFF


def _money(value: Decimal) -> float:
    return float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _payer_rules(payer_name: str) -> dict:
    key = (payer_name or "").lower()
    for name, rules in PAYER_RULES.items():
        if name in key:
            return rules
    return DEFAULT_PAYER_RULES


def _parse_dos(dos: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime((dos or "").strip()[:10], fmt).date()
        except ValueError:
            continue
    return None


def npi_is_valid(npi: str) -> bool:
    """Luhn check with the 80840 prefix per the NPI standard (ISO 7812)."""
    if not npi or len(npi) != 10 or not npi.isdigit():
        return False
    digits = [int(d) for d in "80840" + npi]
    check = digits.pop()
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (total + check) % 10 == 0


def allowed_amount(cpt: str, billed: Decimal, payer_name: str) -> Decimal:
    base = FEE_SCHEDULE.get(cpt)
    factor = _payer_rules(payer_name)["fee_factor"]
    if base is None:
        return (billed * DEFAULT_ALLOWED_RATIO).quantize(Decimal("0.01"))
    return min(billed, (base * factor).quantize(Decimal("0.01")))


# ──────────────────────────────────────────────────────────────────────────
# 270/271 eligibility
# ──────────────────────────────────────────────────────────────────────────

def check_eligibility(payer_name: str, member_id: str) -> dict:
    """
    Simulate a 270/271 eligibility response.

    Deterministic by member ID: ~7% of members have terminated coverage, the
    rest land on one of three benefit tiers with varying cost sharing. Payers
    publish which CPTs require prior authorization; whether an auth is already
    on file for this member is also deterministic (~75% of the time it is).
    """
    rules = _payer_rules(payer_name)
    roll = _stable_pct("elig", payer_name, member_id)

    if roll < 0.04:
        return {
            "active": False,
            "plan_name": f"{payer_name} (coverage terminated)",
            "copay": 0.0,
            "coinsurance": 0.0,
            "deductible_total": 0.0,
            "deductible_remaining": 0.0,
            "prior_auth_cpts": [],
            "prior_auth_on_file": False,
            "termination_note": "Member coverage terminated prior to date of service.",
        }

    tier = PLAN_TIERS[int(roll * 1000) % len(PLAN_TIERS)]
    # Deductible progress varies by member: 0-100% already met.
    met_pct = Decimal(str(round(_stable_pct("ded", member_id), 2)))
    remaining = (tier["deductible_total"] * (Decimal("1.00") - met_pct)).quantize(Decimal("0.01"))

    return {
        "active": True,
        "plan_name": f"{payer_name} {tier['plan_suffix']}",
        "copay": _money(tier["copay"]),
        "coinsurance": float(tier["coinsurance"]),
        "deductible_total": _money(tier["deductible_total"]),
        "deductible_remaining": _money(remaining),
        "prior_auth_cpts": list(rules["auth_cpts"]),
        "prior_auth_on_file": _stable_pct("auth", member_id) < 0.85,
        "termination_note": "",
    }


# ──────────────────────────────────────────────────────────────────────────
# Adjudication
# ──────────────────────────────────────────────────────────────────────────

def _claim_level_denial(state: ClaimState) -> tuple[str, str] | None:
    """Return (carc, rarc) for denials that reject the entire claim."""
    if not npi_is_valid(state.provider_npi):
        return ("16", "N290")
    if not state.patient_member_id.strip():
        return ("16", "MA61")
    if not state.eligibility_active:
        return ("27", "N30")

    dos = _parse_dos(state.date_of_service)
    if dos is None:
        return ("16", "MA130")
    filing_days = _payer_rules(state.payer_name)["filing_days"]
    if (date.today() - dos).days > filing_days:
        return ("29", "N211")

    # Corrected / void claims (837P frequency 7 or 8) intentionally repeat a
    # previously submitted claim, so they must NOT trip the duplicate edit. Per
    # payer rules a replacement/void must carry the original payer claim control
    # number (CMS-1500 box 22 "Original Ref. No." / 837P REF*F8); without it the
    # claim is unprocessable.
    cpt_key = ",".join(sorted(ln.cpt_code for ln in state.claim_lines))
    registry_key = (state.patient_member_id, state.date_of_service, cpt_key)
    frequency_code = (getattr(state, "frequency_code", "1") or "1")
    if frequency_code in ("7", "8"):
        if not (getattr(state, "original_payer_control_number", "") or "").strip():
            return ("16", "MA130")
        # Replacement/void supersedes the prior claim on file.
        _SUBMISSION_REGISTRY[registry_key] = state.claim_id
        return None

    # Exact duplicate: same member + DOS + identical CPT set already on file.
    prior = _SUBMISSION_REGISTRY.get(registry_key)
    if prior is not None and prior != state.claim_id:
        return ("18", "N522")
    _SUBMISSION_REGISTRY[registry_key] = state.claim_id
    return None


def _line_denial(state: ClaimState, line) -> tuple[str, str] | None:
    """Return (carc, rarc) for a single service line, or None if payable."""
    cpt = line.cpt_code
    rules = _payer_rules(state.payer_name)

    # Prior authorization absent for an auth-required service.
    if cpt in rules["auth_cpts"] and not state.prior_auth_on_file:
        return ("197", "N130")

    # Units above the MUE maximum.
    mue = MUE_LIMITS.get(cpt)
    if mue is not None and line.units > mue:
        return ("151", "N362")

    # NCCI bundling: column-2 code not separately payable when a column-1 code
    # is present. A "0"-indicator edit (bypass=None) can never be overridden.
    claim_cpts = {ln.cpt_code for ln in state.claim_lines}
    for pair in NCCI_PAIRS:
        if cpt == pair["column2"] and claim_cpts & set(pair["column1"]):
            bypass = pair.get("bypass")
            if bypass is None or bypass not in line.modifiers:
                return (pair.get("carc", "97"), pair.get("rarc", "N19"))

    # E/M without modifier 25 when billed alongside a same-day procedure.
    if cpt in E_AND_M_CODES and "25" not in line.modifiers:
        if claim_cpts & set(PROCEDURES_REQUIRING_EM_MOD25):
            return ("97", "N19")

    # LCD medical necessity: diagnostic CPTs need a supporting diagnosis.
    necessity = MEDICAL_NECESSITY.get(cpt)
    if necessity is not None:
        supported = any(
            dx.upper().startswith(prefix) for dx in line.icd10_codes for prefix in necessity
        )
        if not line.icd10_codes:
            return ("16", "M76")
        if not supported:
            return ("50", "N115")

    return None


def adjudicate_claim(state: ClaimState) -> dict:
    """
    Adjudicate a claim against payer rules. Returns a dict with:
      clearinghouse_ref, claim_denied, carc_code, rarc_code, denial_reason,
      line_decisions (per-line payment or denial), expected_paid.

    `claim_denied` is True only for claim-level rejections (unprocessable,
    coverage, timely filing, duplicate) or when every line denies. Otherwise
    the claim is accepted and partially/fully paid; line-level denials surface
    on the 835 for reconciliation to catch.
    """
    ref = f"CLH-{uuid.uuid4().hex[:8].upper()}"

    claim_denial = _claim_level_denial(state)
    if claim_denial is not None:
        carc, rarc = claim_denial
        return {
            "clearinghouse_ref": ref,
            "accepted": False,
            "claim_denied": True,
            "carc_code": carc,
            "rarc_code": rarc,
            "denial_reason": CARC_DESCRIPTIONS[carc],
            "line_decisions": [
                {
                    "line_no": ln.line_no,
                    "cpt_code": ln.cpt_code,
                    "billed": _money(Decimal(str(ln.charge))),
                    "allowed": 0.0,
                    "paid": 0.0,
                    "denied": True,
                    "carc_code": carc,
                    "rarc_code": rarc,
                    "group_code": "CO",
                    "adjustments": [],
                }
                for ln in state.claim_lines
            ],
            "expected_paid": 0.0,
        }

    copay = Decimal(str(state.copay))
    coinsurance = Decimal(str(state.coinsurance))
    deductible_remaining = Decimal(str(state.deductible_remaining))
    copay_applied = False

    line_decisions: list[dict] = []
    total_paid = Decimal("0.00")

    for ln in state.claim_lines:
        billed = Decimal(str(ln.charge))
        denial = _line_denial(state, ln)
        if denial is not None:
            carc, rarc = denial
            line_decisions.append({
                "line_no": ln.line_no,
                "cpt_code": ln.cpt_code,
                "billed": _money(billed),
                "allowed": 0.0,
                "paid": 0.0,
                "denied": True,
                "carc_code": carc,
                "rarc_code": rarc,
                "group_code": "CO",
                "adjustments": [
                    {"group": "CO", "carc": carc, "amount": _money(billed),
                     "description": CARC_DESCRIPTIONS[carc]},
                ],
            })
            continue

        allowed = allowed_amount(ln.cpt_code, billed, state.payer_name)
        contractual = billed - allowed
        adjustments: list[dict] = []
        if contractual > 0:
            adjustments.append({
                "group": "CO", "carc": "45", "amount": _money(contractual),
                "description": CARC_DESCRIPTIONS["45"],
            })

        # Patient responsibility: copay (once per visit on the E/M line),
        # then deductible, then coinsurance on the remainder.
        patient_resp = Decimal("0.00")
        remaining_allowed = allowed

        if not copay_applied and ln.cpt_code in E_AND_M_CODES and copay > 0:
            applied = min(copay, remaining_allowed)
            patient_resp += applied
            remaining_allowed -= applied
            copay_applied = True
            adjustments.append({
                "group": "PR", "carc": "3", "amount": _money(applied),
                "description": "Co-payment amount.",
            })

        if deductible_remaining > 0 and remaining_allowed > 0:
            applied = min(deductible_remaining, remaining_allowed)
            patient_resp += applied
            remaining_allowed -= applied
            deductible_remaining -= applied
            adjustments.append({
                "group": "PR", "carc": "1", "amount": _money(applied),
                "description": "Deductible amount.",
            })

        if coinsurance > 0 and remaining_allowed > 0:
            applied = (remaining_allowed * coinsurance).quantize(Decimal("0.01"))
            patient_resp += applied
            remaining_allowed -= applied
            adjustments.append({
                "group": "PR", "carc": "2", "amount": _money(applied),
                "description": "Coinsurance amount.",
            })

        paid = remaining_allowed
        total_paid += paid
        line_decisions.append({
            "line_no": ln.line_no,
            "cpt_code": ln.cpt_code,
            "billed": _money(billed),
            "allowed": _money(allowed),
            "paid": _money(paid),
            "denied": False,
            "carc_code": "",
            "rarc_code": "",
            "group_code": "",
            "patient_responsibility": _money(patient_resp),
            "adjustments": adjustments,
        })

    all_denied = bool(line_decisions) and all(d["denied"] for d in line_decisions)
    primary = next((d for d in line_decisions if d["denied"]), None)

    return {
        "clearinghouse_ref": ref,
        "accepted": True,
        "claim_denied": all_denied,
        "carc_code": primary["carc_code"] if all_denied and primary else "",
        "rarc_code": primary["rarc_code"] if all_denied and primary else "",
        "denial_reason": CARC_DESCRIPTIONS.get(primary["carc_code"], "") if all_denied and primary else "",
        "line_decisions": line_decisions,
        "expected_paid": _money(total_paid),
    }


# ──────────────────────────────────────────────────────────────────────────
# 835 / ERA generation
# ──────────────────────────────────────────────────────────────────────────

def generate_era(state: ClaimState, adjudication: dict | None = None) -> dict:
    """
    Generate the simulated 835/ERA for a previously adjudicated claim.

    A deterministic ~10% of paid claims contain a payer underpayment on the
    highest-paying line (real-world: incorrect fee schedule load, sequestration)
    so the reconciliation variance gate has genuine work to do.
    """
    if adjudication is None:
        adjudication = adjudicate_claim(state)

    lines = [dict(d) for d in adjudication["line_decisions"]]
    underpaid = False

    if not adjudication["claim_denied"]:
        if _stable_pct("underpay", state.claim_id) < 0.10:
            payable = [d for d in lines if not d["denied"] and d["paid"] > 0]
            if payable:
                target = max(payable, key=lambda d: d["paid"])
                shortfall = round(target["paid"] * 0.35, 2)
                target["paid"] = round(target["paid"] - shortfall, 2)
                target["adjustments"] = target.get("adjustments", []) + [{
                    "group": "OA", "carc": "45", "amount": shortfall,
                    "description": "Payer fee schedule discrepancy (underpayment).",
                }]
                target["underpaid"] = True
                underpaid = True

    total_billed = round(sum(d["billed"] for d in lines), 2)
    total_paid = round(sum(d["paid"] for d in lines), 2)
    total_patient_resp = round(sum(d.get("patient_responsibility", 0.0) for d in lines), 2)

    check_no = f"CHK{int(_stable_pct('chk', state.claim_id) * 900000) + 100000}"

    return {
        "check_number": check_no,
        "payer_name": state.payer_name or "Simulated Payer Inc.",
        "service_date": state.date_of_service or date.today().isoformat(),
        "total_billed": total_billed,
        "total_paid": total_paid,
        "total_patient_responsibility": total_patient_resp,
        "carc_code": adjudication["carc_code"],
        "rarc_code": adjudication["rarc_code"],
        "underpayment_detected": underpaid,
        "lines": lines,
    }
