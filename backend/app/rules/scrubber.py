"""
Pre-submission claim scrubber.

Runs the edits a commercial scrubber runs before a claim leaves the building:
identifiers, code validity, NCCI bundling, MUE units, modifier rules, dates,
filing limits, prior authorization, and LCD-style medical necessity. Each
finding carries a severity and the rule it cites:

  - "error":   claim will be rejected/denied as-is — block submission
  - "warning": likely payment problem or compliance risk — submit with caution

The scrubber intentionally shares rule data with the mock payer's adjudication
engine, the way a real scrubber encodes payer policy: a clean scrub should
mean a clean claim.
"""
from __future__ import annotations

from datetime import date, datetime

from app.schemas.claim_state import ClaimState, ScrubFinding
from app.rules.code_reference import (
    E_AND_M_CODES,
    MODIFIER_REFERENCE,
    cpt_description,
    cpt_format_valid,
    icd10_description,
    icd10_format_valid,
)
from app.services.mock_payer import (
    MEDICAL_NECESSITY,
    MUE_LIMITS,
    NCCI_PAIRS,
    PROCEDURES_REQUIRING_EM_MOD25,
    npi_is_valid,
    _payer_rules,
)


def _parse_date(raw: str) -> date | None:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime((raw or "").strip()[:10], fmt).date()
        except ValueError:
            continue
    return None


def _finding(severity: str, rule: str, message: str, line_no: int | None = None) -> ScrubFinding:
    return ScrubFinding(severity=severity, rule=rule, message=message, line_no=line_no)


def scrub_claim(state: ClaimState) -> list[ScrubFinding]:
    findings: list[ScrubFinding] = []
    findings.extend(_check_identifiers(state))
    findings.extend(_check_dates(state))
    findings.extend(_check_lines(state))
    findings.extend(_check_code_validity(state))
    findings.extend(_check_ncci_and_modifiers(state))
    findings.extend(_check_units(state))
    findings.extend(_check_prior_auth(state))
    findings.extend(_check_medical_necessity(state))
    return findings


# ── Identifiers ──────────────────────────────────────────────────────────

def _check_identifiers(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    npi = state.provider_npi.strip()
    if not npi:
        out.append(_finding("error", "NPI-01", "Billing provider NPI is missing (CMS-1500 box 33a)."))
    elif len(npi) != 10 or not npi.isdigit():
        out.append(_finding("error", "NPI-02", f"NPI '{npi}' is not 10 digits."))
    elif not npi_is_valid(npi):
        out.append(_finding(
            "error", "NPI-03",
            f"NPI {npi} fails the Luhn check-digit test (ISO 7812, 80840 prefix) — "
            f"payer will reject as unprocessable (CARC 16 / RARC N290).",
        ))

    if not state.patient_member_id.strip():
        out.append(_finding(
            "error", "SUB-01",
            "Subscriber/member ID is missing (CMS-1500 box 1a) — claim is unprocessable (CARC 16 / MA61).",
        ))
    if not state.patient_name.strip():
        out.append(_finding("error", "SUB-02", "Patient name is missing (CMS-1500 box 2)."))
    if not state.patient_dob.strip():
        out.append(_finding("warning", "SUB-03", "Patient date of birth is missing (CMS-1500 box 3)."))
    if not state.payer_name.strip():
        out.append(_finding("error", "SUB-04", "Payer name is missing — claim cannot be routed."))
    return out


# ── Dates & filing limits ────────────────────────────────────────────────

def _check_dates(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    dos = _parse_date(state.date_of_service)
    if dos is None:
        out.append(_finding(
            "error", "DOS-01",
            f"Date of service '{state.date_of_service}' is missing or unparseable (CMS-1500 box 24A).",
        ))
        return out

    today = date.today()
    if dos > today:
        out.append(_finding("error", "DOS-02", f"Date of service {dos.isoformat()} is in the future."))

    dob = _parse_date(state.patient_dob)
    if dob is not None and dob > dos:
        out.append(_finding("error", "DOS-03", "Patient date of birth is after the date of service."))

    filing_days = _payer_rules(state.payer_name)["filing_days"]
    age_days = (today - dos).days
    if age_days > filing_days:
        out.append(_finding(
            "error", "TFL-01",
            f"Claim is {age_days} days old — exceeds {state.payer_name or 'payer'} timely filing "
            f"limit of {filing_days} days (CARC 29). Payment is generally unrecoverable.",
        ))
    elif age_days > filing_days - 14:
        out.append(_finding(
            "warning", "TFL-02",
            f"Claim is {age_days} days old — within {filing_days - age_days} day(s) of the "
            f"{filing_days}-day timely filing limit. Submit immediately.",
        ))
    return out


# ── Line-level basics ────────────────────────────────────────────────────

def _check_lines(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    if not state.claim_lines:
        out.append(_finding("error", "LN-01", "No service lines on claim (CMS-1500 box 24)."))
        return out
    for ln in state.claim_lines:
        if not ln.icd10_codes:
            out.append(_finding(
                "error", "LN-02",
                f"CPT {ln.cpt_code} has no diagnosis pointer — every service line must link "
                f"to at least one ICD-10 code (box 24E).",
                ln.line_no,
            ))
        if ln.charge <= 0:
            out.append(_finding(
                "error", "LN-03", f"CPT {ln.cpt_code} has invalid charge ${ln.charge:.2f}.", ln.line_no,
            ))
        if ln.units <= 0:
            out.append(_finding(
                "error", "LN-04", f"CPT {ln.cpt_code} has invalid units ({ln.units}).", ln.line_no,
            ))
    return out


# ── Code set validity ────────────────────────────────────────────────────

def _check_code_validity(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    for ln in state.claim_lines:
        if not cpt_format_valid(ln.cpt_code):
            out.append(_finding(
                "error", "CPT-01", f"'{ln.cpt_code}' is not a valid CPT/HCPCS code format.", ln.line_no,
            ))
        elif cpt_description(ln.cpt_code) is None:
            out.append(_finding(
                "warning", "CPT-02",
                f"CPT {ln.cpt_code} is not in the loaded fee schedule/code reference — verify before submission.",
                ln.line_no,
            ))
        for dx in ln.icd10_codes:
            if not icd10_format_valid(dx):
                out.append(_finding(
                    "error", "ICD-01", f"'{dx}' is not a valid ICD-10-CM code format.", ln.line_no,
                ))
            elif icd10_description(dx) is None:
                out.append(_finding(
                    "warning", "ICD-02",
                    f"ICD-10 {dx} not found in loaded code reference — verify it is billable and current.",
                    ln.line_no,
                ))
        for mod in ln.modifiers:
            if mod not in MODIFIER_REFERENCE:
                out.append(_finding(
                    "warning", "MOD-01", f"Modifier '{mod}' on CPT {ln.cpt_code} is not recognized.", ln.line_no,
                ))
    return out


# ── NCCI bundling & modifier rules ───────────────────────────────────────

def _check_ncci_and_modifiers(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    claim_cpts = {ln.cpt_code for ln in state.claim_lines}

    for ln in state.claim_lines:
        for pair in NCCI_PAIRS:
            if ln.cpt_code == pair["column2"] and claim_cpts & set(pair["column1"]):
                bypass = pair.get("bypass")
                if bypass is None or bypass not in ln.modifiers:
                    col1 = next(iter(claim_cpts & set(pair["column1"])))
                    if bypass is None:
                        # "0"-indicator edit (e.g. status-B bundled code): no
                        # modifier can make it separately payable.
                        fix = (
                            f"Remove the line — {pair.get('rationale', 'not separately payable')} "
                            f"No modifier overrides this edit."
                        )
                    else:
                        fix = (
                            f"Remove the line, or append modifier {bypass} only if it was a truly "
                            f"distinct service ({pair.get('rationale', 'bundled')})."
                        )
                    out.append(_finding(
                        "error", "NCCI-01",
                        f"NCCI edit: CPT {ln.cpt_code} is not separately payable when billed with "
                        f"CPT {col1} — will deny CO-{pair.get('carc', '97')}. {fix}",
                        ln.line_no,
                    ))

        if ln.cpt_code in E_AND_M_CODES and "25" not in ln.modifiers:
            same_day_procs = claim_cpts & set(PROCEDURES_REQUIRING_EM_MOD25)
            if same_day_procs:
                out.append(_finding(
                    "error", "MOD-25",
                    f"E/M {ln.cpt_code} billed same day as procedure "
                    f"{', '.join(sorted(same_day_procs))} requires modifier 25 on the E/M line "
                    f"to attest a significant, separately identifiable service — will deny "
                    f"CO-97 (bundled) without it.",
                    ln.line_no,
                ))

        if "25" in ln.modifiers and ln.cpt_code not in E_AND_M_CODES:
            out.append(_finding(
                "warning", "MOD-02",
                f"Modifier 25 on CPT {ln.cpt_code} is invalid — modifier 25 applies only to E/M services.",
                ln.line_no,
            ))
        if "59" in ln.modifiers and ln.cpt_code in E_AND_M_CODES:
            out.append(_finding(
                "warning", "MOD-03",
                f"Modifier 59 on E/M {ln.cpt_code} is inappropriate — use modifier 25 for E/M services.",
                ln.line_no,
            ))
    return out


# ── MUE units ────────────────────────────────────────────────────────────

def _check_units(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    for ln in state.claim_lines:
        mue = MUE_LIMITS.get(ln.cpt_code)
        if mue is not None and ln.units > mue:
            out.append(_finding(
                "error", "MUE-01",
                f"CPT {ln.cpt_code} billed with {ln.units} units — exceeds the MUE "
                f"(Medically Unlikely Edit) maximum of {mue}/day. Will deny CARC 151.",
                ln.line_no,
            ))
    return out


# ── Prior authorization ──────────────────────────────────────────────────

def _check_prior_auth(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    if not state.prior_auth_cpts:
        return out
    for ln in state.claim_lines:
        if ln.cpt_code in state.prior_auth_cpts and not state.prior_auth_on_file:
            out.append(_finding(
                "error", "AUTH-01",
                f"{state.payer_name} requires prior authorization for CPT {ln.cpt_code} and no "
                f"authorization is on file — will deny CARC 197. Obtain retro-auth before submitting.",
                ln.line_no,
            ))
    return out


# ── LCD medical necessity ────────────────────────────────────────────────

def _check_medical_necessity(state: ClaimState) -> list[ScrubFinding]:
    out: list[ScrubFinding] = []
    for ln in state.claim_lines:
        necessity = MEDICAL_NECESSITY.get(ln.cpt_code)
        if necessity is None or not ln.icd10_codes:
            continue
        supported = any(
            dx.upper().startswith(prefix) for dx in ln.icd10_codes for prefix in necessity
        )
        if not supported:
            out.append(_finding(
                "error", "LCD-01",
                f"CPT {ln.cpt_code} ({cpt_description(ln.cpt_code) or 'procedure'}) is not "
                f"supported by diagnosis {', '.join(ln.icd10_codes)} under coverage policy — "
                f"will deny CARC 50 (not medically necessary, LCD). Link a covered diagnosis "
                f"or attach an ABN.",
                ln.line_no,
            ))
    return out
