from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from app.schemas.claim_state import ClaimState
from app.schemas.patient import PatientProfileUpdate
from app.services.supabase_client import get_supabase

_DOC_BUCKET = "documents"

BASE_PATIENT_COLUMNS = [
    "id", "org_id", "first_name", "last_name", "dob", "member_id", "payer_name",
]

EXTENDED_PATIENT_COLUMNS = [
    "middle_name", "preferred_name", "gender", "ssn_last4",
    "address_line1", "address_line2", "city", "state", "zip_code",
    "phone_primary", "phone_secondary", "email",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
    "responsible_party_name", "responsible_party_relationship",
    "responsible_party_dob", "responsible_party_phone",
    "insurance_plan_name", "insurance_group_number", "insurance_plan_type",
    "insurance_effective_date", "insurance_copay", "insurance_deductible",
    "secondary_payer_name", "secondary_member_id", "notes",
    "created_at", "updated_at",
]

_PROFILE_UPDATE_FIELDS = [
    "first_name", "last_name", "middle_name", "preferred_name", "gender", "dob",
    "ssn_last4", "member_id", "payer_name",
    "address_line1", "address_line2", "city", "state", "zip_code",
    "phone_primary", "phone_secondary", "email",
    "emergency_contact_name", "emergency_contact_relationship", "emergency_contact_phone",
    "responsible_party_name", "responsible_party_relationship",
    "responsible_party_dob", "responsible_party_phone",
    "insurance_plan_name", "insurance_group_number", "insurance_plan_type",
    "insurance_effective_date", "insurance_copay", "insurance_deductible",
    "secondary_payer_name", "secondary_member_id", "notes",
]

_extended_columns_available: bool | None = None


def _patient_columns() -> list[str]:
    global _extended_columns_available
    if _extended_columns_available is True:
        return BASE_PATIENT_COLUMNS + EXTENDED_PATIENT_COLUMNS
    if _extended_columns_available is False:
        return BASE_PATIENT_COLUMNS
    try:
        get_supabase().table("patients").select("middle_name").limit(1).execute()
        _extended_columns_available = True
    except Exception:
        _extended_columns_available = False
    return _patient_columns()


def _parse_patient_name(name: str) -> tuple[str, str]:
    raw = (name or "").strip()
    if not raw:
        return "", ""
    if "," in raw:
        parts = [p.strip() for p in raw.split(",", 1)]
        last = parts[0]
        first = parts[1] if len(parts) > 1 else ""
        return first, last
    parts = raw.split()
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _active_insurance(patient: dict) -> bool:
    eff = patient.get("insurance_effective_date")
    if not eff:
        return bool(patient.get("payer_name"))
    try:
        eff_date = date.fromisoformat(str(eff)[:10])
        return eff_date <= date.today()
    except ValueError:
        return bool(patient.get("payer_name"))


def _claim_stats_for_encounters(encounter_ids: list[str]) -> dict[str, Any]:
    if not encounter_ids:
        return {"claims": [], "total_claims": 0, "total_billed": 0.0, "total_pr": 0.0}
    try:
        claims = (
            get_supabase()
            .table("claims")
            .select("*")
            .in_("encounter_id", encounter_ids)
            .order("created_at", desc=True)
            .execute()
            .data
            or []
        )
    except Exception:
        claims = []
    total_billed = sum(float(c.get("total_charge") or 0) for c in claims)
    total_pr = sum(float(c.get("patient_responsibility") or 0) for c in claims)
    return {
        "claims": claims,
        "total_claims": len(claims),
        "total_billed": round(total_billed, 2),
        "total_pr": round(total_pr, 2),
    }


def _last_visit(encounters: list[dict]) -> str:
    dates = [str(e.get("date_of_service") or "")[:10] for e in encounters if e.get("date_of_service")]
    return max(dates) if dates else ""


def _fetch_encounters(patient_id: str) -> list[dict]:
    try:
        return (
            get_supabase()
            .table("encounters")
            .select("*")
            .eq("patient_id", patient_id)
            .execute()
            .data
            or []
        )
    except Exception:
        return []


def _fetch_appointments(patient_id: str) -> list[dict]:
    try:
        rows = (
            get_supabase()
            .table("patient_appointments")
            .select("*")
            .eq("patient_id", patient_id)
            .execute()
            .data
            or []
        )
    except Exception:
        return []
    today = date.today().isoformat()
    upcoming = sorted(
        [r for r in rows if str(r.get("appointment_date", ""))[:10] >= today],
        key=lambda r: (str(r.get("appointment_date", "")), str(r.get("appointment_time") or "")),
    )
    past = sorted(
        [r for r in rows if str(r.get("appointment_date", ""))[:10] < today],
        key=lambda r: str(r.get("appointment_date", "")),
        reverse=True,
    )
    return upcoming + past


def _fetch_documents(patient_id: str) -> list[dict]:
    try:
        return (
            get_supabase()
            .table("patient_documents")
            .select("*")
            .eq("patient_id", patient_id)
            .order("uploaded_at", desc=True)
            .execute()
            .data
            or []
        )
    except Exception:
        return []


def list_patients(q: str = "", limit: int = 20, offset: int = 0) -> dict:
    cols = ",".join(_patient_columns())
    try:
        rows = (
            get_supabase()
            .table("patients")
            .select(cols)
            .order("last_name")
            .limit(500)
            .execute()
            .data
            or []
        )
    except Exception:
        rows = (
            get_supabase()
            .table("patients")
            .select(",".join(BASE_PATIENT_COLUMNS))
            .order("last_name")
            .limit(500)
            .execute()
            .data
            or []
        )

    if q:
        needle = q.strip().lower()
        rows = [
            r for r in rows
            if needle in f"{r.get('first_name', '')} {r.get('last_name', '')}".lower()
            or needle in (r.get("member_id") or "").lower()
            or needle in (r.get("payer_name") or "").lower()
            or needle in (r.get("phone_primary") or "").lower()
        ]

    page_rows = rows[offset:offset + limit]
    items: list[dict] = []
    for patient in page_rows:
        pid = patient["id"]
        encounters = _fetch_encounters(pid)
        enc_ids = [e["id"] for e in encounters if e.get("id")]
        stats = _claim_stats_for_encounters(enc_ids)
        items.append({
            "id": pid,
            "first_name": patient.get("first_name") or "",
            "last_name": patient.get("last_name") or "",
            "dob": str(patient.get("dob") or "")[:10],
            "payer_name": patient.get("payer_name") or "",
            "member_id": patient.get("member_id") or "",
            "phone_primary": patient.get("phone_primary") or "",
            "total_claims": stats["total_claims"],
            "total_billed": stats["total_billed"],
            "last_visit": _last_visit(encounters),
        })

    return {"items": items, "total": len(rows), "limit": limit, "offset": offset}


def get_patient_detail(patient_id: str) -> dict | None:
    cols = ",".join(_patient_columns())
    try:
        result = get_supabase().table("patients").select(cols).eq("id", patient_id).limit(1).execute()
    except Exception:
        result = (
            get_supabase()
            .table("patients")
            .select(",".join(BASE_PATIENT_COLUMNS))
            .eq("id", patient_id)
            .limit(1)
            .execute()
        )
    if not result.data:
        return None

    patient = result.data[0]
    encounters = _fetch_encounters(patient_id)
    enc_ids = [e["id"] for e in encounters if e.get("id")]
    claim_data = _claim_stats_for_encounters(enc_ids)

    return {
        "patient": patient,
        "claims": claim_data["claims"],
        "appointments": _fetch_appointments(patient_id),
        "documents": _fetch_documents(patient_id),
        "stats": {
            "total_claims": claim_data["total_claims"],
            "total_billed": claim_data["total_billed"],
            "total_patient_responsibility": claim_data["total_pr"],
            "active_insurance": _active_insurance(patient),
        },
    }


def update_patient_profile(patient_id: str, body: PatientProfileUpdate) -> dict | None:
    patch: dict[str, Any] = {}
    for field in _PROFILE_UPDATE_FIELDS:
        val = getattr(body, field, None)
        if val is not None:
            patch[field] = val
    if not patch:
        detail = get_patient_detail(patient_id)
        return detail["patient"] if detail else None

    patch["updated_at"] = datetime.utcnow().isoformat()
    try:
        result = (
            get_supabase()
            .table("patients")
            .update(patch)
            .eq("id", patient_id)
            .execute()
        )
        if result.data:
            return result.data[0]
    except Exception as exc:
        # Drop extended fields if migration not applied yet.
        basic_patch = {k: v for k, v in patch.items() if k in BASE_PATIENT_COLUMNS or k == "updated_at"}
        if basic_patch:
            result = (
                get_supabase()
                .table("patients")
                .update(basic_patch)
                .eq("id", patient_id)
                .execute()
            )
            if result.data:
                return result.data[0]
        print(f"[patients] update error: {exc}")
    detail = get_patient_detail(patient_id)
    return detail["patient"] if detail else None


def list_appointments(patient_id: str) -> list[dict]:
    return _fetch_appointments(patient_id)


def create_appointment(patient_id: str, org_id: str, data: dict) -> dict | None:
    row = {
        "patient_id": patient_id,
        "org_id": org_id or None,
        **data,
    }
    try:
        result = get_supabase().table("patient_appointments").insert(row).execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        print(f"[patients] appointment insert error: {exc}")
        return None


def delete_appointment(patient_id: str, appointment_id: str) -> bool:
    try:
        get_supabase().table("patient_appointments").delete().eq(
            "id", appointment_id,
        ).eq("patient_id", patient_id).execute()
        return True
    except Exception as exc:
        print(f"[patients] appointment delete error: {exc}")
        return False


def list_documents(patient_id: str) -> list[dict]:
    return _fetch_documents(patient_id)


def create_document(patient_id: str, org_id: str, data: dict) -> dict | None:
    row = {
        "patient_id": patient_id,
        "org_id": org_id or None,
        **data,
    }
    try:
        result = get_supabase().table("patient_documents").insert(row).execute()
        return result.data[0] if result.data else None
    except Exception as exc:
        print(f"[patients] document insert error: {exc}")
        return None


def delete_document(patient_id: str, document_id: str) -> bool:
    doc = None
    try:
        rows = (
            get_supabase()
            .table("patient_documents")
            .select("*")
            .eq("id", document_id)
            .eq("patient_id", patient_id)
            .limit(1)
            .execute()
            .data
            or []
        )
        doc = rows[0] if rows else None
    except Exception:
        pass

    try:
        get_supabase().table("patient_documents").delete().eq(
            "id", document_id,
        ).eq("patient_id", patient_id).execute()
    except Exception as exc:
        print(f"[patients] document delete error: {exc}")
        return False

    if doc and doc.get("storage_path"):
        try:
            get_supabase().storage.from_(_DOC_BUCKET).remove([doc["storage_path"]])
        except Exception:
            pass
    return True


def upload_patient_document(
    patient_id: str,
    org_id: str,
    filename: str,
    content: bytes,
    document_type: str,
    notes: str = "",
) -> dict | None:
    safe_name = filename.replace("\\", "/").split("/")[-1] or "document.pdf"
    storage_path = f"patient-documents/{patient_id}/{safe_name}"
    try:
        get_supabase().storage.from_(_DOC_BUCKET).upload(
            storage_path,
            content,
            file_options={"content-type": "application/octet-stream", "upsert": "true"},
        )
    except Exception as exc:
        print(f"[patients] document upload error: {exc}")
        return None

    return create_document(patient_id, org_id, {
        "document_type": document_type,
        "document_name": safe_name,
        "storage_path": storage_path,
        "notes": notes or None,
    })


def document_download_url(storage_path: str, expires_in: int = 3600) -> str | None:
    try:
        result = get_supabase().storage.from_(_DOC_BUCKET).create_signed_url(
            storage_path, expires_in,
        )
        if isinstance(result, dict):
            return result.get("signedURL") or result.get("signedUrl")
        return None
    except Exception as exc:
        print(f"[patients] signed URL error: {exc}")
        return None


def upsert_patient_from_claim(state: ClaimState) -> None:
    """Auto-enrich patient profile after pipeline; link claim via encounter."""
    member_id = (state.patient_member_id or "").strip()
    payer_name = (state.payer_name or "").strip()
    if not member_id or not payer_name:
        return

    first, last = _parse_patient_name(state.patient_name)
    sb = get_supabase()

    existing: dict | None = None
    try:
        rows = (
            sb.table("patients")
            .select(",".join(_patient_columns()))
            .eq("member_id", member_id)
            .eq("payer_name", payer_name)
            .limit(1)
            .execute()
            .data
            or []
        )
        existing = rows[0] if rows else None
    except Exception:
        try:
            rows = (
                sb.table("patients")
                .select(",".join(BASE_PATIENT_COLUMNS))
                .eq("member_id", member_id)
                .eq("payer_name", payer_name)
                .limit(1)
                .execute()
                .data
                or []
            )
            existing = rows[0] if rows else None
        except Exception as exc:
            print(f"[patients] lookup error: {exc}")
            return

    def _fill(row: dict) -> dict:
        patch: dict[str, Any] = {}
        if first and not row.get("first_name"):
            patch["first_name"] = first
        if last and not row.get("last_name"):
            patch["last_name"] = last
        if state.patient_dob and not row.get("dob"):
            patch["dob"] = state.patient_dob[:10]
        if state.copay and not row.get("insurance_copay"):
            patch["insurance_copay"] = state.copay
        if state.deductible_total and not row.get("insurance_deductible"):
            patch["insurance_deductible"] = state.deductible_total
        if state.plan_name and not row.get("insurance_plan_name"):
            patch["insurance_plan_name"] = state.plan_name
        return patch

    patient_id: str
    org_id = state.org_id or (existing or {}).get("org_id") or ""

    if existing:
        patient_id = existing["id"]
        org_id = org_id or existing.get("org_id") or ""
        patch = _fill(existing)
        if patch:
            patch["updated_at"] = datetime.utcnow().isoformat()
            try:
                sb.table("patients").update(patch).eq("id", patient_id).execute()
            except Exception as exc:
                print(f"[patients] enrich update error: {exc}")
    else:
        insert_row: dict[str, Any] = {
            "org_id": org_id or None,
            "first_name": first,
            "last_name": last,
            "dob": state.patient_dob[:10] if state.patient_dob else None,
            "member_id": member_id,
            "payer_name": payer_name,
        }
        if state.copay:
            insert_row["insurance_copay"] = state.copay
        if state.deductible_total:
            insert_row["insurance_deductible"] = state.deductible_total
        if state.plan_name:
            insert_row["insurance_plan_name"] = state.plan_name
        try:
            result = sb.table("patients").insert(insert_row).execute()
            patient_id = result.data[0]["id"]
        except Exception:
            try:
                basic = {k: insert_row[k] for k in BASE_PATIENT_COLUMNS if k in insert_row and k != "id"}
                basic["org_id"] = org_id or None
                result = sb.table("patients").insert(basic).execute()
                patient_id = result.data[0]["id"]
            except Exception as exc:
                print(f"[patients] insert error: {exc}")
                return

    # Link claim to patient via encounter so claims history works for uploads.
    try:
        claim_row = sb.table("claims").select("encounter_id").eq("id", state.claim_id).limit(1).execute()
        if claim_row.data and claim_row.data[0].get("encounter_id"):
            return

        enc = sb.table("encounters").insert({
            "org_id": org_id or None,
            "patient_id": patient_id,
            "provider_name": state.provider_name or "Dr. Emily Carter MD",
            "provider_npi": state.provider_npi or "1234567893",
            "date_of_service": state.date_of_service[:10] if state.date_of_service else date.today().isoformat(),
        }).execute()
        encounter_id = enc.data[0]["id"]
        sb.table("claims").update({"encounter_id": encounter_id}).eq("id", state.claim_id).execute()
    except Exception as exc:
        print(f"[patients] encounter link error: {exc}")
