from pydantic import BaseModel, Field


class ConfidenceScores(BaseModel):
    patient_name: float = 1.0
    patient_dob: float = 1.0
    patient_member_id: float = 1.0
    payer_name: float = 1.0
    provider_name: float = 1.0
    provider_npi: float = 1.0
    date_of_service: float = 1.0


class ExtractedLine(BaseModel):
    cpt_code: str
    modifiers: list[str] = Field(default_factory=list)
    icd10_codes: list[str]
    units: int = 1
    charge: float
    description: str = ""


class SuperbillExtraction(BaseModel):
    """Structured output from the vision extraction LLM call."""
    patient_name: str
    patient_dob: str
    patient_member_id: str
    payer_name: str
    provider_name: str
    provider_npi: str
    date_of_service: str
    lines: list[ExtractedLine]
    confidence: ConfidenceScores = Field(default_factory=ConfidenceScores)
    extraction_notes: str = ""
