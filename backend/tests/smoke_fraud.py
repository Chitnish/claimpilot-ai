"""Smoke test for cross-claim / cross-provider fraud signals.
Run from backend/: .\\.venv\\Scripts\\python.exe tests\\smoke_fraud.py
"""
from __future__ import annotations
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.schemas.claim_state import ClaimState, ClaimLine
from app.services import fraud_signals as fs


def make_state(claim_id, npi, member, dos, lines, total=None):
    s = ClaimState(
        claim_id=claim_id,
        provider_npi=npi,
        patient_member_id=member,
        date_of_service=dos,
        claim_lines=lines,
    )
    s.total_charge = total if total is not None else sum(ln.charge for ln in lines)
    return s


def line(cpt, charge, dx="E11.9"):
    return ClaimLine(line_no=1, cpt_code=cpt, modifiers=[], icd10_codes=[dx], units=1, charge=charge)


def check(label, cond, detail=""):
    print(f"{'PASS' if cond else 'FAIL'} | {label} {detail}")
    if not cond:
        sys.exit(1)


# ── Duplicate / cloned claim ──────────────────────────────────────────
fs.reset()
a = make_state("dup-a", "1234567893", "M1", "2026-06-01", [line("99213", 185.0)])
fs.evaluate(a)
b = make_state("dup-b", "1234567893", "M1", "2026-06-01", [line("99213", 185.0)])
r = fs.evaluate(b)
check("duplicate/cloned claim flagged", r["signals"]["duplicate_clone"], str(r["reasons"]))

# A different member with the same codes is NOT a duplicate.
c = make_state("dup-c", "1234567893", "M2", "2026-06-01", [line("99213", 185.0)])
r = fs.evaluate(c)
check("different member not a duplicate", not r["signals"]["duplicate_clone"])

# ── E/M upcoding skew ─────────────────────────────────────────────────
fs.reset()
last = None
for i in range(4):
    s = make_state(f"up-{i}", "1999999991", f"U{i}", "2026-06-02", [line("99215", 320.0)])
    last = fs.evaluate(s)
check("upcoding skew flagged at 100% level-4/5", last["signals"]["upcoding_skew"], str(last["reasons"]))

# A provider billing mostly level-3 visits is not flagged.
fs.reset()
last = None
for i in range(5):
    s = make_state(f"ok-{i}", "1888888887", f"K{i}", "2026-06-02", [line("99213", 185.0)])
    last = fs.evaluate(s)
check("normal E/M mix not flagged for upcoding", not last["signals"]["upcoding_skew"])

# ── Charge outlier vs peers ───────────────────────────────────────────
fs.reset()
for i in range(12):
    charge = 180.0 + (i % 5) * 12.0  # peer charges ~180-228, real variance
    fs.evaluate(make_state(f"peer-{i}", f"17000000{i:02d}", f"P{i}", "2026-06-03",
                           [line("99213", charge)], total=charge))
outlier = fs.evaluate(make_state("outlier-1", "1700000099", "PX", "2026-06-03",
                                 [line("99215", 6000.0)], total=6000.0))
check("charge outlier flagged", outlier["signals"]["charge_outlier"], str(outlier["reasons"]))

# ── Improbable single-day volume ──────────────────────────────────────
fs.reset()
last = None
for i in range(VOLUME := 16):
    s = make_state(f"vol-{i}", "1600000006", f"V{i}", "2026-06-04", [line("99213", 185.0)])
    last = fs.evaluate(s)
check("single-day volume spike flagged", last["signals"]["volume_spike"], str(last["reasons"]))

print("\nAll fraud-signal smoke tests passed.")
