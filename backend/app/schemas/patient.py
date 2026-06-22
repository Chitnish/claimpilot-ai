from __future__ import annotations

from pydantic import BaseModel, Field


class PatientProfileUpdate(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    middle_name: str | None = None
    preferred_name: str | None = None
    gender: str | None = None
    dob: str | None = None
    ssn_last4: str | None = None
    member_id: str | None = None
    payer_name: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    phone_primary: str | None = None
    phone_secondary: str | None = None
    email: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_relationship: str | None = None
    emergency_contact_phone: str | None = None
    responsible_party_name: str | None = None
    responsible_party_relationship: str | None = None
    responsible_party_dob: str | None = None
    responsible_party_phone: str | None = None
    insurance_plan_name: str | None = None
    insurance_group_number: str | None = None
    insurance_plan_type: str | None = None
    insurance_effective_date: str | None = None
    insurance_copay: float | None = None
    insurance_deductible: float | None = None
    secondary_payer_name: str | None = None
    secondary_member_id: str | None = None
    notes: str | None = None


class PatientDocumentCreate(BaseModel):
    document_type: str
    document_name: str
    storage_path: str
    notes: str = ""


class PatientAppointmentCreate(BaseModel):
    appointment_date: str
    appointment_time: str | None = None
    provider_name: str = ""
    appointment_type: str = "office_visit"
    status: str = "scheduled"
    notes: str = ""


class PatientStats(BaseModel):
    total_claims: int = 0
    total_billed: float = 0.0
    total_patient_responsibility: float = 0.0
    active_insurance: bool = False


class PatientListItem(BaseModel):
    id: str
    first_name: str = ""
    last_name: str = ""
    dob: str = ""
    payer_name: str = ""
    member_id: str = ""
    phone_primary: str = ""
    total_claims: int = 0
    total_billed: float = 0.0
    last_visit: str = ""


class PatientDetailResponse(BaseModel):
    patient: dict
    claims: list[dict] = Field(default_factory=list)
    appointments: list[dict] = Field(default_factory=list)
    documents: list[dict] = Field(default_factory=list)
    stats: PatientStats = Field(default_factory=PatientStats)
