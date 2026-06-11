"""Load trained ML models and run denial-risk / anomaly inference."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap

ML_DIR = Path(__file__).resolve().parent

_denial_artifact: dict | None = None
_anomaly_model = None
_denial_loaded = False
_anomaly_loaded = False

NUMERIC_COLS = [
    "has_modifier",
    "coding_issues",
    "npi_valid",
    "charge_amount",
    "prior_auth_required",
    "num_dx_codes",
    "date_of_service_month",
]


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


def _parse_service_month(date_str: str) -> int:
    if not date_str:
        return 6
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(date_str.strip()[:10], fmt).month
        except ValueError:
            continue
    return 6


def _extract_claim_fields(state_dict: dict) -> tuple[str, int, int]:
    """Return (cpt_code, has_modifier, num_dx_codes) from claim lines."""
    claim_lines = state_dict.get("claim_lines", [])
    cpt_code = "99213"
    has_modifier = 0
    dx_codes: set[str] = set()

    if claim_lines:
        first_line = claim_lines[0]
        if isinstance(first_line, dict):
            cpt_code = first_line.get("cpt_code", "99213")
        else:
            cpt_code = getattr(first_line, "cpt_code", "99213")

    for line in claim_lines:
        if isinstance(line, dict):
            modifiers = line.get("modifiers", [])
            icd10_codes = line.get("icd10_codes", [])
        else:
            modifiers = getattr(line, "modifiers", [])
            icd10_codes = getattr(line, "icd10_codes", [])
        if modifiers:
            has_modifier = 1
        dx_codes.update(icd10_codes)

    return cpt_code, has_modifier, len(dx_codes)


def _format_feature_name(name: str) -> str:
    label = name.replace("payer_", "Payer: ").replace("cpt_", "CPT: ")
    label = label.replace("_", " ")
    return label.title()


def build_feature_vector(state_dict: dict) -> pd.DataFrame:
    _ensure_denial_loaded()
    if _denial_artifact is None:
        raise RuntimeError("Denial model artifact not loaded")

    feature_columns: list[str] = _denial_artifact["feature_columns"]
    cpt_code, has_modifier, num_dx_codes = _extract_claim_fields(state_dict)

    row = pd.DataFrame(
        [
            {
                "payer_name": state_dict.get("payer_name", ""),
                "cpt_code": cpt_code,
                "has_modifier": has_modifier,
                "coding_issues": len(state_dict.get("coding_issues", [])),
                "npi_valid": 1 if len(state_dict.get("provider_npi", "")) == 10 else 0,
                "charge_amount": state_dict.get("total_charge", 0.0),
                "prior_auth_required": 0,
                "num_dx_codes": num_dx_codes,
                "date_of_service_month": _parse_service_month(
                    state_dict.get("date_of_service", "")
                ),
            }
        ]
    )

    payer_dummies = pd.get_dummies(row["payer_name"], prefix="payer")
    cpt_dummies = pd.get_dummies(row["cpt_code"], prefix="cpt")
    X = pd.concat([row[NUMERIC_COLS], payer_dummies, cpt_dummies], axis=1)
    return X.reindex(columns=feature_columns, fill_value=0)


def _compute_shap_explanations(model, X: pd.DataFrame) -> list[str]:
    explainer = shap.TreeExplainer(model)
    shap_values = explainer(X)

    if hasattr(shap_values, "values"):
        vals = shap_values.values[0]
    elif isinstance(shap_values, list):
        vals = shap_values[1][0]
    else:
        vals = shap_values[0]

    feature_names = X.columns.tolist()
    top_indices = np.argsort(np.abs(vals))[-3:][::-1]

    explanations: list[str] = []
    for idx in top_indices:
        name = _format_feature_name(feature_names[idx])
        explanations.append(f"{name}: {vals[idx]:+.2f}")
    return explanations


async def predict_denial_risk(state_dict: dict) -> tuple[float, list[str]]:
    _ensure_denial_loaded()
    if _denial_artifact is None:
        return (0.5, ["Model not loaded"])

    try:
        X = build_feature_vector(state_dict)
        model = _denial_artifact["model"]
        risk_score = float(model.predict_proba(X)[:, 1][0])
        explanations = await asyncio.to_thread(_compute_shap_explanations, model, X)
        return (risk_score, explanations)
    except Exception:
        return (0.5, ["Prediction error"])


def score_anomaly(state_dict: dict) -> float:
    _ensure_anomaly_loaded()
    if _anomaly_model is None:
        return 0.0

    try:
        _, has_modifier, num_dx_codes = _extract_claim_fields(state_dict)
        features = np.array(
            [
                [
                    state_dict.get("total_charge", 0.0),
                    len(state_dict.get("coding_issues", [])),
                    num_dx_codes,
                    has_modifier,
                ]
            ]
        )
        raw_score = _anomaly_model.decision_function(features)[0]
        return float(1 / (1 + np.exp(raw_score)))
    except Exception:
        return 0.0
