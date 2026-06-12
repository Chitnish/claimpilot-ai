"""
Shared feature engineering for the denial-risk model.

Features are restricted to what a billing office can observe BEFORE
submission. Payer-side hidden state (whether a prior auth is actually on
file, whether coverage terminated) is deliberately excluded — that is the
irreducible uncertainty a real denial model lives with.
"""
from __future__ import annotations

from datetime import date, datetime

import pandas as pd

PAYER_KEYS = ["bluecross", "aetna", "united", "cigna", "humana"]
CPT_UNIVERSE = ["99213", "99214", "99215", "93000", "85025", "80053", "99000"]

E_AND_M = {"99202", "99203", "99204", "99205", "99211", "99212", "99213", "99214", "99215"}

NUMERIC_FEATURES = [
    "charge_amount",
    "num_lines",
    "num_dx_codes",
    "dos_age_days",
    "npi_valid",
    "member_id_present",
    "em_mod25_missing",
    "bundled_99000",
    "unsupported_dx_lines",
    "units_over_mue",
    "auth_required_cpt_present",
    "near_filing_limit",
]


def _parse_dos_age(dos: str) -> int:
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            d = datetime.strptime((dos or "").strip()[:10], fmt).date()
            return max((date.today() - d).days, 0)
        except ValueError:
            continue
    return 30


def claim_features(state_dict: dict) -> dict:
    """Extract model features from a ClaimState dict (or equivalent)."""
    from app.services.mock_payer import (
        MEDICAL_NECESSITY, MUE_LIMITS, NCCI_PAIRS,
        PROCEDURES_REQUIRING_EM_MOD25, npi_is_valid, _payer_rules,
    )

    lines = state_dict.get("claim_lines", []) or []

    def lval(line, key, default=None):
        if isinstance(line, dict):
            return line.get(key, default)
        return getattr(line, key, default)

    cpts = {lval(ln, "cpt_code", "") for ln in lines}
    payer_name = state_dict.get("payer_name", "") or ""
    payer_lower = payer_name.lower()

    em_mod25_missing = 0
    bundled_99000 = 0
    unsupported_dx_lines = 0
    units_over_mue = 0
    num_dx = set()

    for ln in lines:
        cpt = lval(ln, "cpt_code", "")
        mods = lval(ln, "modifiers", []) or []
        dxs = lval(ln, "icd10_codes", []) or []
        units = lval(ln, "units", 1) or 1
        num_dx.update(dxs)

        if cpt in E_AND_M and "25" not in mods and cpts & set(PROCEDURES_REQUIRING_EM_MOD25):
            em_mod25_missing = 1
        for pair in NCCI_PAIRS:
            if cpt == pair["column2"] and cpts & set(pair["column1"]) and pair["bypass"] not in mods:
                bundled_99000 = 1

        necessity = MEDICAL_NECESSITY.get(cpt)
        if necessity is not None and dxs:
            if not any(dx.upper().startswith(p) for dx in dxs for p in necessity):
                unsupported_dx_lines += 1

        mue = MUE_LIMITS.get(cpt)
        if mue is not None and units > mue:
            units_over_mue = 1

    rules = _payer_rules(payer_name)
    auth_required_present = int(bool(cpts & set(rules["auth_cpts"])))
    dos_age = _parse_dos_age(state_dict.get("date_of_service", ""))
    near_limit = int(dos_age > rules["filing_days"] - 14)

    feats: dict = {
        "charge_amount": float(state_dict.get("total_charge", 0.0) or 0.0),
        "num_lines": len(lines),
        "num_dx_codes": len(num_dx),
        "dos_age_days": dos_age,
        "npi_valid": int(npi_is_valid(state_dict.get("provider_npi", "") or "")),
        "member_id_present": int(bool((state_dict.get("patient_member_id", "") or "").strip())),
        "em_mod25_missing": em_mod25_missing,
        "bundled_99000": bundled_99000,
        "unsupported_dx_lines": unsupported_dx_lines,
        "units_over_mue": units_over_mue,
        "auth_required_cpt_present": auth_required_present,
        "near_filing_limit": near_limit,
    }
    for key in PAYER_KEYS:
        feats[f"payer_{key}"] = int(key in payer_lower)
    for cpt in CPT_UNIVERSE:
        feats[f"cpt_{cpt}"] = int(cpt in cpts)
    return feats


def feature_frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    cols = NUMERIC_FEATURES + [f"payer_{k}" for k in PAYER_KEYS] + [f"cpt_{c}" for c in CPT_UNIVERSE]
    return df.reindex(columns=cols, fill_value=0)
