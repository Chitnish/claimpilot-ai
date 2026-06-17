"""Quick smoke test of the deterministic adjudication engine.
Run from backend/: .\\.venv\\Scripts\\python.exe tests\\smoke_adjudication.py
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.claim_state import ClaimState, ClaimLine
from app.services.mock_payer import (
    adjudicate_claim, check_eligibility, generate_era, npi_is_valid,
)

VALID_NPI = "1234567893"  # passes Luhn with 80840 prefix


def make_state(**overrides) -> ClaimState:
    base = dict(
        patient_name="Test, Patient",
        patient_member_id="BC123456",
        payer_name="BlueCross BlueShield",
        provider_npi=VALID_NPI,
        date_of_service="2026-06-01",
        eligibility_active=True,
        copay=30.0,
        coinsurance=0.10,
        deductible_remaining=0.0,
        claim_lines=[
            ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["E11.9"], units=1, charge=185.0),
            ClaimLine(line_no=2, cpt_code="80053", modifiers=[], icd10_codes=["E11.9"], units=1, charge=52.0),
        ],
    )
    base.update(overrides)
    s = ClaimState(**base)
    s.total_charge = sum(ln.charge for ln in s.claim_lines)
    return s


def check(label: str, cond: bool, detail: str = "") -> None:
    print(f"{'PASS' if cond else 'FAIL'} | {label} {detail}")
    if not cond:
        sys.exit(1)


# NPI Luhn
check("valid NPI accepted", npi_is_valid(VALID_NPI))
check("seed NPI 1234567890 rejected", not npi_is_valid("1234567890"))

# Clean claim pays with PR split
s = make_state()
r = adjudicate_claim(s)
check("clean claim accepted", r["accepted"] and not r["claim_denied"], f"expected_paid={r['expected_paid']}")
l1 = r["line_decisions"][0]
check("copay applied on E/M line", any(a["group"] == "PR" and a["carc"] == "3" for a in l1["adjustments"]))
check("CO-45 contractual on line", any(a["group"] == "CO" and a["carc"] == "45" for a in l1["adjustments"]))

# Invalid NPI -> CARC 16 / N290
r = adjudicate_claim(make_state(claim_id="c2", provider_npi="1234567890"))
check("bad NPI denies CARC 16", r["claim_denied"] and r["carc_code"] == "16" and r["rarc_code"] == "N290")

# Terminated coverage -> CARC 27
r = adjudicate_claim(make_state(claim_id="c3", eligibility_active=False))
check("inactive coverage denies CARC 27", r["claim_denied"] and r["carc_code"] == "27")

# Timely filing (United = 90 days) -> CARC 29
r = adjudicate_claim(make_state(claim_id="c4", payer_name="United HealthCare", date_of_service="2025-06-01"))
check("stale DOS denies CARC 29", r["claim_denied"] and r["carc_code"] == "29")

# Duplicate -> CARC 18
a = make_state(claim_id="dup-a", patient_member_id="DUP1", date_of_service="2026-06-05")
b = make_state(claim_id="dup-b", patient_member_id="DUP1", date_of_service="2026-06-05")
adjudicate_claim(a)
r = adjudicate_claim(b)
check("duplicate denies CARC 18", r["claim_denied"] and r["carc_code"] == "18")

# Prior auth absent (Humana requires auth for 80053) -> line CARC 197
s = make_state(claim_id="c5", patient_member_id="HU555001", payer_name="Humana", prior_auth_on_file=False)
r = adjudicate_claim(s)
line2 = next(d for d in r["line_decisions"] if d["cpt_code"] == "80053")
check("missing auth denies line CARC 197", line2["denied"] and line2["carc_code"] == "197")
check("claim still accepted (partial)", not r["claim_denied"])

# MUE -> CARC 151
s = make_state(claim_id="c6", patient_member_id="BC600001")
s.claim_lines[1].units = 3
r = adjudicate_claim(s)
line2 = next(d for d in r["line_decisions"] if d["cpt_code"] == "80053")
check("MUE violation denies CARC 151", line2["denied"] and line2["carc_code"] == "151")

# LCD medical necessity: ECG with only back pain dx -> CARC 50 / N115
s = make_state(claim_id="c7", patient_member_id="BC700001", claim_lines=[
    ClaimLine(line_no=1, cpt_code="93000", modifiers=[], icd10_codes=["M54.5"], units=1, charge=89.0),
])
r = adjudicate_claim(s)
check("unsupported dx denies CARC 50", r["claim_denied"] and r["carc_code"] == "50" and r["rarc_code"] == "N115")

# E/M without modifier 25 next to same-day immunization admin -> E/M line CARC 97
s = make_state(claim_id="c8", patient_member_id="BC800001", claim_lines=[
    ClaimLine(line_no=1, cpt_code="99214", modifiers=[], icd10_codes=["I10"], units=1, charge=250.0),
    ClaimLine(line_no=2, cpt_code="90471", modifiers=[], icd10_codes=["Z23"], units=1, charge=35.0),
])
r = adjudicate_claim(s)
em = next(d for d in r["line_decisions"] if d["cpt_code"] == "99214")
check("E/M w/o mod 25 denies CARC 97", em["denied"] and em["carc_code"] == "97")

# Same claim WITH modifier 25 pays
s = make_state(claim_id="c9", patient_member_id="BC900001", claim_lines=[
    ClaimLine(line_no=1, cpt_code="99214", modifiers=["25"], icd10_codes=["I10"], units=1, charge=250.0),
    ClaimLine(line_no=2, cpt_code="90471", modifiers=[], icd10_codes=["Z23"], units=1, charge=35.0),
])
r = adjudicate_claim(s)
em = next(d for d in r["line_decisions"] if d["cpt_code"] == "99214")
check("E/M with mod 25 pays", not em["denied"])

# A diagnostic ECG does NOT bundle the E/M -> E/M pays without modifier 25
s = make_state(claim_id="c8b", patient_member_id="BC811001", claim_lines=[
    ClaimLine(line_no=1, cpt_code="99214", modifiers=[], icd10_codes=["I10"], units=1, charge=250.0),
    ClaimLine(line_no=2, cpt_code="93000", modifiers=[], icd10_codes=["I10"], units=1, charge=89.0),
])
r = adjudicate_claim(s)
em = next(d for d in r["line_decisions"] if d["cpt_code"] == "99214")
check("ECG does not bundle E/M", not em["denied"])

# Panel unbundling: BMP (80048) billed with CMP (80053) -> 80048 line CARC 97 / M15
s = make_state(claim_id="c11", patient_member_id="BC110501", claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["E11.9"], units=1, charge=185.0),
    ClaimLine(line_no=2, cpt_code="80053", modifiers=[], icd10_codes=["E11.9"], units=1, charge=52.0),
    ClaimLine(line_no=3, cpt_code="80048", modifiers=[], icd10_codes=["E11.9"], units=1, charge=35.0),
])
r = adjudicate_claim(s)
bmp = next(d for d in r["line_decisions"] if d["cpt_code"] == "80048")
check("BMP within CMP denies CARC 97 / M15",
      bmp["denied"] and bmp["carc_code"] == "97" and bmp["rarc_code"] == "M15")

# Status-B specimen handling (99000) is never separately payable, even w/ modifier 59
s = make_state(claim_id="c12", patient_member_id="BC120501", claim_lines=[
    ClaimLine(line_no=1, cpt_code="99213", modifiers=[], icd10_codes=["E11.9"], units=1, charge=185.0),
    ClaimLine(line_no=2, cpt_code="99000", modifiers=["59"], icd10_codes=["E11.9"], units=1, charge=15.0),
])
r = adjudicate_claim(s)
sh = next(d for d in r["line_decisions"] if d["cpt_code"] == "99000")
check("99000 status B denies even with modifier 59", sh["denied"] and sh["carc_code"] == "97")

# Corrected claim (frequency 7) is NOT treated as a duplicate of the original
orig = make_state(claim_id="orig-1", patient_member_id="BC777001", date_of_service="2026-06-07")
adjudicate_claim(orig)  # registers the original in the duplicate registry
corr = make_state(claim_id="corr-1", patient_member_id="BC777001", date_of_service="2026-06-07")
corr.frequency_code = "7"
corr.original_payer_control_number = "CLH-ABCD1234"
r = adjudicate_claim(corr)
check("corrected claim not flagged duplicate",
      not (r["claim_denied"] and r["carc_code"] == "18"))

# Corrected claim WITHOUT the original payer control number is unprocessable
corr2 = make_state(claim_id="corr-2", patient_member_id="BC778001", date_of_service="2026-06-08")
corr2.frequency_code = "7"
r = adjudicate_claim(corr2)
check("corrected claim missing original ref unprocessable",
      r["claim_denied"] and r["carc_code"] == "16" and r["rarc_code"] == "MA130")

# ERA totals are consistent
s = make_state(claim_id="c10", patient_member_id="BC100001")
adj = adjudicate_claim(s)
era = generate_era(s, adj)
check("ERA totals consistent",
      abs(era["total_paid"] - sum(d["paid"] for d in era["lines"])) < 0.01,
      f"paid={era['total_paid']}")

# Eligibility determinism + variety
e1 = check_eligibility("Aetna PPO", "AE111111")
e2 = check_eligibility("Aetna PPO", "AE111111")
check("eligibility deterministic", e1 == e2)
plans = {check_eligibility("Cigna", f"CI{i:06d}")["plan_name"] for i in range(40)}
check("plan variety", len(plans) >= 3, str(plans))
inactive = sum(1 for i in range(200) if not check_eligibility("Cigna", f"CX{i:06d}")["active"])
check("some members inactive (~7%)", 4 <= inactive <= 30, f"inactive={inactive}/200")

print("\nAll adjudication smoke tests passed.")
