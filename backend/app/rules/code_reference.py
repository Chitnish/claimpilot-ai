"""
Curated ICD-10-CM and CPT reference data for validation and display.

A production system would load the full CMS code sets (~70k ICD-10-CM codes,
~10k CPT). This curated subset covers the demo universe plus common primary
care codes, with real code meanings.
"""
from __future__ import annotations

import re

ICD10_FORMAT = re.compile(r"^[A-TV-Z][0-9][0-9A-Z](\.[0-9A-Z]{1,4})?$")
CPT_FORMAT = re.compile(r"^\d{4}[0-9U]$|^[A-V]\d{4}$")  # CPT I/III + HCPCS Level II

ICD10_REFERENCE: dict[str, str] = {
    "E11.9":   "Type 2 diabetes mellitus without complications",
    "E11.65":  "Type 2 diabetes mellitus with hyperglycemia",
    "E78.5":   "Hyperlipidemia, unspecified",
    "E66.9":   "Obesity, unspecified",
    "E03.9":   "Hypothyroidism, unspecified",
    "I10":     "Essential (primary) hypertension",
    "I25.10":  "Atherosclerotic heart disease of native coronary artery without angina pectoris",
    "I48.91":  "Unspecified atrial fibrillation",
    "J06.9":   "Acute upper respiratory infection, unspecified",
    "J45.909": "Unspecified asthma, uncomplicated",
    "J02.9":   "Acute pharyngitis, unspecified",
    "K21.9":   "Gastro-esophageal reflux disease without esophagitis",
    "M54.5":   "Low back pain",
    "M25.561": "Pain in right knee",
    "M79.10":  "Myalgia, unspecified site",
    "N39.0":   "Urinary tract infection, site not specified",
    "F41.1":   "Generalized anxiety disorder",
    "F32.9":   "Major depressive disorder, single episode, unspecified",
    "R07.9":   "Chest pain, unspecified",
    "R10.9":   "Unspecified abdominal pain",
    "R53.83":  "Other fatigue",
    "R00.0":   "Tachycardia, unspecified",
    "Z00.00":  "Encounter for general adult medical examination without abnormal findings",
    "Z23":     "Encounter for immunization",
    "Z79.4":   "Long term (current) use of insulin",
    "D64.9":   "Anemia, unspecified",
    "R50.9":   "Fever, unspecified",
}

CPT_REFERENCE: dict[str, str] = {
    "99202": "Office/outpatient visit, new patient, straightforward MDM (15-29 min)",
    "99203": "Office/outpatient visit, new patient, low MDM (30-44 min)",
    "99204": "Office/outpatient visit, new patient, moderate MDM (45-59 min)",
    "99205": "Office/outpatient visit, new patient, high MDM (60-74 min)",
    "99211": "Office/outpatient visit, established patient, minimal",
    "99212": "Office/outpatient visit, established patient, straightforward MDM",
    "99213": "Office/outpatient visit, established patient, low MDM (20-29 min)",
    "99214": "Office/outpatient visit, established patient, moderate MDM (30-39 min)",
    "99215": "Office/outpatient visit, established patient, high MDM (40-54 min)",
    "93000": "Electrocardiogram, routine ECG with at least 12 leads; with interpretation and report",
    "85025": "Blood count; complete (CBC), automated, with automated differential WBC count",
    "80048": "Basic metabolic panel (Calcium, total)",
    "80053": "Comprehensive metabolic panel",
    "80061": "Lipid panel",
    "83036": "Hemoglobin; glycosylated (A1C)",
    "81002": "Urinalysis, non-automated, without microscopy",
    "36415": "Collection of venous blood by venipuncture",
    "90471": "Immunization administration; one vaccine",
    "99000": "Handling and/or conveyance of specimen for transfer to a laboratory",
}

# Modifiers this practice's specialty plausibly uses, with meanings.
MODIFIER_REFERENCE: dict[str, str] = {
    "24": "Unrelated E/M service by same physician during postoperative period",
    "25": "Significant, separately identifiable E/M service by same physician on same day as procedure",
    "50": "Bilateral procedure",
    "59": "Distinct procedural service",
    "76": "Repeat procedure by same physician",
    "77": "Repeat procedure by another physician",
    "LT": "Left side",
    "RT": "Right side",
}

E_AND_M_CODES = frozenset({
    "99202", "99203", "99204", "99205",
    "99211", "99212", "99213", "99214", "99215",
})


def icd10_description(code: str) -> str | None:
    return ICD10_REFERENCE.get(code.upper())


def cpt_description(code: str) -> str | None:
    return CPT_REFERENCE.get(code)


def icd10_format_valid(code: str) -> bool:
    return bool(ICD10_FORMAT.match(code.upper()))


def cpt_format_valid(code: str) -> bool:
    return bool(CPT_FORMAT.match(code.upper()))
