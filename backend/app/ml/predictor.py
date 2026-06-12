"""Load trained ML models and run denial-risk / anomaly inference.

SHAP attributions are translated into billing-specialist language with an
approximate probability impact, e.g.:
  "Modifier 25 missing on E/M billed with same-day procedure (+24% risk)"
"""
from __future__ import annotations

import asyncio
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

from app.ml.features import claim_features, feature_frame

ML_DIR = Path(__file__).resolve().parent

_denial_artifact: dict | None = None
_anomaly_model = None
_denial_loaded = False
_anomaly_loaded = False


def _ensure_denial_loaded() -> None:
    global _denial_artifact, _denial_loaded
    if _denial_loaded:
        return
    _denial_loaded = True
    path = ML_DIR / "denial_model.pkl"
    if path.exists():
        _denial_artifact = joblib.load(path)
    else:
        print(f"Warning: denial model not found at {path}")
        _denial_artifact = None


def _ensure_anomaly_loaded() -> None:
    global _anomaly_model, _anomaly_loaded
    if _anomaly_loaded:
        return
    _anomaly_loaded = True
    path = ML_DIR / "anomaly_model.pkl"
    if path.exists():
        _anomaly_model = joblib.load(path)
    else:
        print(f"Warning: anomaly model not found at {path}")
        _anomaly_model = None


def _describe_feature(name: str, value: float, increases_risk: bool) -> str:
    """Plain-English description of a feature's contribution."""
    if name == "em_mod25_missing":
        return ("Modifier 25 missing on E/M billed with same-day procedure"
                if value else "No modifier-25 bundling conflicts")
    if name == "bundled_99000":
        return ("Specimen handling (99000) bundled into E/M — NCCI edit"
                if value else "No NCCI bundling conflicts")
    if name == "unsupported_dx_lines":
        return (f"{int(value)} line(s) where diagnosis does not support the procedure (LCD policy)"
                if value else "All diagnoses support the billed procedures")
    if name == "units_over_mue":
        return ("Units exceed the Medically Unlikely Edit maximum"
                if value else "Units within MUE limits")
    if name == "npi_valid":
        return ("Provider NPI passes check-digit validation"
                if value else "Provider NPI fails check-digit validation")
    if name == "member_id_present":
        return ("Member ID present" if value else "Member ID missing")
    if name == "auth_required_cpt_present":
        return ("Claim includes a service this payer requires prior authorization for"
                if value else "No prior-auth-required services on claim")
    if name == "near_filing_limit":
        return ("Claim is near or past the payer's timely filing limit"
                if value else "Well within timely filing limit")
    if name == "dos_age_days":
        return f"Claim age: {int(value)} days since date of service"
    if name == "charge_amount":
        return f"Total billed charge ${value:,.2f}"
    if name == "num_lines":
        return f"{int(value)} service line(s) on claim"
    if name == "num_dx_codes":
        return f"{int(value)} distinct diagnosis code(s)"
    if name.startswith("payer_"):
        payer = name.removeprefix("payer_").title()
        return f"Payer mix: {payer}" if value else f"Payer is not {payer}"
    if name.startswith("cpt_"):
        cpt = name.removeprefix("cpt_")
        return f"CPT {cpt} on claim" if value else f"No CPT {cpt} on claim"
    return name.replace("_", " ").title()


def _sigmoid(x: float) -> float:
    return float(1 / (1 + np.exp(-x)))


def _compute_explanations(model, X: pd.DataFrame) -> list[str]:
    explainer = shap.TreeExplainer(model)
    sv = explainer(X)
    vals = sv.values[0] if hasattr(sv, "values") else np.asarray(sv)[0]
    base = float(sv.base_values[0]) if hasattr(sv, "base_values") else 0.0

    f_total = base + float(np.sum(vals))
    p_total = _sigmoid(f_total)

    feature_names = X.columns.tolist()
    row = X.iloc[0]
    top = np.argsort(np.abs(vals))[-3:][::-1]

    out: list[str] = []
    for idx in top:
        phi = float(vals[idx])
        if abs(phi) < 1e-6:
            continue
        # Local approximation: probability with vs. without this feature's contribution.
        delta_p = p_total - _sigmoid(f_total - phi)
        desc = _describe_feature(feature_names[idx], float(row.iloc[idx]), phi > 0)
        out.append(f"{desc} ({delta_p:+.0%} risk)")
    return out or ["No significant risk factors identified"]


async def predict_denial_risk(state_dict: dict) -> tuple[float, list[str]]:
    _ensure_denial_loaded()
    if _denial_artifact is None:
        return (0.5, ["Model not loaded"])

    try:
        X = feature_frame([claim_features(state_dict)])
        X = X.reindex(columns=_denial_artifact["feature_columns"], fill_value=0)
        model = _denial_artifact["model"]
        risk_score = float(model.predict_proba(X)[:, 1][0])
        explanations = await asyncio.to_thread(_compute_explanations, model, X)
        return (risk_score, explanations)
    except Exception as exc:
        print(f"[predictor] denial inference error: {exc}")
        return (0.5, ["Prediction error"])


def score_anomaly(state_dict: dict) -> float:
    _ensure_anomaly_loaded()
    if _anomaly_model is None:
        return 0.0

    try:
        feats = claim_features(state_dict)
        features = pd.DataFrame([{
            "charge_amount": feats["charge_amount"],
            "num_lines": feats["num_lines"],
            "num_dx_codes": feats["num_dx_codes"],
            "units_over_mue": feats["units_over_mue"],
        }])
        raw_score = _anomaly_model.decision_function(features)[0]
        return float(1 / (1 + np.exp(raw_score)))
    except Exception as exc:
        print(f"[predictor] anomaly inference error: {exc}")
        return 0.0
