"""Smoke test for the pre-submission scrubber.
Run from backend/: .\\.venv\\Scripts\\python.exe tests\\smoke_scrubber.py
"""
from __future__ import annotations
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.claim_state import ClaimState, ClaimLine
from app.rules.scrubber import scrub_claim

VALID_NPI = "1234567893"
RECENT_DOS = (date.today() - timedelta(days=5)).isoformat()


def make_state(**overrides) -> ClaimState:
    base = dict(
        patient_name="Test, Patient",
        patient_dob="1980-01-15",
        patient_member_id="BC123456",
        payer_name="BlueCross BlueShield",
        provider_npi=VALID_NPI,
        date_of_service=RECENT_DOS,
        eligibility_active=True,
        claim_lines=[
            ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["E11.9"], units=1, charge=185.0),
        ],
    )
    base.update(overrides)
    return ClaimState(**base)


def rules_of(findings, severity=None):
    return [f.rule for f in findings if severity is None or f.severity == severity]


def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} | {label} {detail}")
    if not cond:
        sys.exit(1)


# Clean claim -> no errors
f = scrub_claim(make_state())
check("clean claim has no errors", not rules_of(f, "error"), str(rules_of(f)))

# Invalid NPI
f = scrub_claim(make_state(provider_npi="1234567890"))
check("Luhn-invalid NPI flagged", "NPI-03" in rules_of(f, "error"))

# Future DOS
f = scrub_claim(make_state(date_of_service=(date.today() + timedelta(days=3)).isoformat()))
check("future DOS flagged", "DOS-02" in rules_of(f, "error"))

# Timely filing (United 90 days)
f = scrub_claim(make_state(payer_name="United HealthCare",
                           date_of_service=(date.today() - timedelta(days=120)).isoformat()))
check("timely filing flagged", "TFL-01" in rules_of(f, "error"))

# Timely filing warning window
f = scrub_claim(make_state(payer_name="United HealthCare",
                           date_of_service=(date.today() - timedelta(days=85)).isoformat()))
check("near filing limit warns", "TFL-02" in rules_of(f, "warning"))

# Missing dx pointer
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=[], units=1, charge=185.0)]))
check("missing dx flagged", "LN-02" in rules_of(f, "error"))

# Bad ICD-10 format
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["11.9E"], units=1, charge=185.0)]))
check("bad ICD-10 format flagged", "ICD-01" in rules_of(f, "error"))

# Unknown but well-formed ICD-10 -> warning only
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["A09"], units=1, charge=185.0)]))
check("unknown ICD-10 warns", "ICD-02" in rules_of(f, "warning"))

# NCCI: 99000 bundled into E/M
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["E11.9"], units=1, charge=185.0),
    ClaimLine(line_no=2, cpt_code="99000", modifiers=[], icd10_codes=["E11.9"], units=1, charge=15.0)]))
check("NCCI bundling flagged", "NCCI-01" in rules_of(f, "error"))

# E/M + ECG without modifier 25
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99214", modifiers=[], icd10_codes=["I10"], units=1, charge=250.0),
    ClaimLine(line_no=2, cpt_code="93000", modifiers=[], icd10_codes=["I10"], units=1, charge=89.0)]))
check("missing modifier 25 flagged", "MOD-25" in rules_of(f, "error"))

# Same with modifier 25 -> clean
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99214", modifiers=["25"], icd10_codes=["I10"], units=1, charge=250.0),
    ClaimLine(line_no=2, cpt_code="93000", modifiers=[], icd10_codes=["I10"], units=1, charge=89.0)]))
check("modifier 25 satisfies edit", "MOD-25" not in rules_of(f))

# MUE
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="80053", modifiers=[], icd10_codes=["E11.9"], units=4, charge=208.0)]))
check("MUE flagged", "MUE-01" in rules_of(f, "error"))

# Prior auth missing
f = scrub_claim(make_state(payer_name="Humana", prior_auth_cpts=["80053"], prior_auth_on_file=False,
                           claim_lines=[
    ClaimLine(line_no=1, cpt_code="80053", modifiers=[], icd10_codes=["E11.9"], units=1, charge=52.0)]))
check("missing prior auth flagged", "AUTH-01" in rules_of(f, "error"))

# LCD necessity: ECG with back pain only
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="93000", modifiers=[], icd10_codes=["M54.5"], units=1, charge=89.0)]))
check("LCD necessity flagged", "LCD-01" in rules_of(f, "error"))

# Modifier misuse: 59 on E/M
f = scrub_claim(make_state(claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=["59"], icd10_codes=["E11.9"], units=1, charge=185.0)]))
check("modifier 59 on E/M warns", "MOD-03" in rules_of(f, "warning"))

print("\nAll scrubber smoke tests passed.")
