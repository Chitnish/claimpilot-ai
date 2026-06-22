"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Calendar,
  ChevronDown,
  Edit,
  FileText,
  Loader2,
  Save,
  Upload,
  X,
} from "lucide-react";

import {
  createPatientAppointment,
  getPatient,
  updatePatient,
  uploadPatientDocument,
} from "@/lib/api";
import {
  denialRiskColor,
  displayText,
  formatCurrency,
  formatStatus,
  statusBadgeVariant,
  truncateId,
} from "@/lib/claim-ui";
import {
  appointmentStatusBadge,
  badgeClass,
  documentTypeBadge,
  formatAddress,
  formatAppointmentType,
  formatDate,
  formatDocumentType,
  formatTime,
  patientFullName,
} from "@/lib/patient-ui";
import type { PatientDetail, PatientRecord } from "@/lib/schemas";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/30";

const labelClass = "text-xs font-medium text-muted-foreground";

const DOCUMENT_TYPES = [
  { value: "lab_result", label: "Lab Result" },
  { value: "appointment_note", label: "Appointment Note" },
  { value: "referral", label: "Referral" },
  { value: "imaging", label: "Imaging" },
  { value: "insurance_card", label: "Insurance Card" },
  { value: "other", label: "Other" },
] as const;

const APPOINTMENT_TYPES = [
  "office_visit",
  "lab",
  "imaging",
  "follow_up",
  "specialist",
  "other",
] as const;

function Field({
  label,
  value,
  editing,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  editing: boolean;
  onChange: (v: string) => void;
  type?: string;
}): React.ReactElement {
  return (
    <div>
      <p className={labelClass}>{label}</p>
      {editing ? (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputClass}
        />
      ) : (
        <p className="text-sm">{displayText(value) || "—"}</p>
      )}
    </div>
  );
}

export default function PatientDetailPage(): React.ReactElement {
  const params = useParams();
  const router = useRouter();
  const patientId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [detail, setDetail] = useState<PatientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PatientRecord | null>(null);
  const [saving, setSaving] = useState(false);

  const [showPastAppts, setShowPastAppts] = useState(false);
  const [showAddAppt, setShowAddAppt] = useState(false);
  const [apptDate, setApptDate] = useState("");
  const [apptTime, setApptTime] = useState("");
  const [apptProvider, setApptProvider] = useState("Dr. Emily Carter MD");
  const [apptType, setApptType] = useState("office_visit");
  const [apptNotes, setApptNotes] = useState("");
  const [addingAppt, setAddingAppt] = useState(false);

  const [docType, setDocType] = useState("other");
  const [docNotes, setDocNotes] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const data = await getPatient(patientId);
      setDetail(data);
      setDraft(data.patient);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load patient");
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const upcomingAppts =
    detail?.appointments.filter((a) => a.appointmentDate.slice(0, 10) >= today) ?? [];
  const pastAppts =
    detail?.appointments.filter((a) => a.appointmentDate.slice(0, 10) < today) ?? [];

  const handleSave = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      await updatePatient(patientId, draft);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleAddAppointment = async (): Promise<void> => {
    if (!apptDate) return;
    setAddingAppt(true);
    try {
      await createPatientAppointment(patientId, {
        appointment_date: apptDate,
        appointment_time: apptTime || undefined,
        provider_name: apptProvider,
        appointment_type: apptType,
        notes: apptNotes || undefined,
      });
      setShowAddAppt(false);
      setApptDate("");
      setApptTime("");
      setApptNotes("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add appointment");
    } finally {
      setAddingAppt(false);
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await uploadPatientDocument(patientId, file, docType, docNotes);
      setDocNotes("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload document");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 size-5 animate-spin" />
        Loading patient profile…
      </div>
    );
  }

  if (error && !detail) {
    return <p className="p-8 text-center text-red-600">{error}</p>;
  }

  if (!detail || !draft) {
    return <p className="p-8 text-center text-muted-foreground">Patient not found.</p>;
  }

  const p = editing ? draft : detail.patient;
  const fullName = patientFullName(p.firstName, p.lastName, p.middleName);

  return (
    <div className="p-6 lg:p-8">
      {error && (
        <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#1e3a5f]">{fullName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Member ID {displayText(p.memberId)} · {displayText(p.payerName)}
          </p>
        </div>
        <div className="flex gap-2">
          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(detail.patient);
                  setEditing(false);
                }}
              >
                <X className="mr-1 size-4" />
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
                disabled={saving}
                onClick={() => void handleSave()}
              >
                {saving ? (
                  <Loader2 className="mr-1 size-4 animate-spin" />
                ) : (
                  <Save className="mr-1 size-4" />
                )}
                Save
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditing(true)}
            >
              <Edit className="mr-1 size-4" />
              Edit
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base text-[#1e3a5f]">Demographics</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="First Name" value={p.firstName} editing={editing}
              onChange={(v) => setDraft({ ...draft, firstName: v })} />
            <Field label="Last Name" value={p.lastName} editing={editing}
              onChange={(v) => setDraft({ ...draft, lastName: v })} />
            <Field label="Preferred Name" value={p.preferredName} editing={editing}
              onChange={(v) => setDraft({ ...draft, preferredName: v })} />
            <Field label="Gender" value={p.gender} editing={editing}
              onChange={(v) => setDraft({ ...draft, gender: v })} />
            <Field label="Date of Birth" value={p.dob.slice(0, 10)} editing={editing}
              onChange={(v) => setDraft({ ...draft, dob: v })} type="date" />
            <Field label="SSN (last 4)" value={p.ssnLast4} editing={editing}
              onChange={(v) => setDraft({ ...draft, ssnLast4: v })} />
            <div className="sm:col-span-2">
              {editing ? (
                <>
                  <Field label="Address Line 1" value={p.addressLine1} editing
                    onChange={(v) => setDraft({ ...draft, addressLine1: v })} />
                  <div className="mt-3">
                    <Field label="Address Line 2" value={p.addressLine2} editing
                      onChange={(v) => setDraft({ ...draft, addressLine2: v })} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <Field label="City" value={p.city} editing
                      onChange={(v) => setDraft({ ...draft, city: v })} />
                    <Field label="State" value={p.state} editing
                      onChange={(v) => setDraft({ ...draft, state: v })} />
                    <Field label="ZIP" value={p.zipCode} editing
                      onChange={(v) => setDraft({ ...draft, zipCode: v })} />
                  </div>
                </>
              ) : (
                <div>
                  <p className={labelClass}>Address</p>
                  <p className="text-sm">
                    {formatAddress(p.addressLine1, p.addressLine2, p.city, p.state, p.zipCode)}
                  </p>
                </div>
              )}
            </div>
            <Field label="Phone (primary)" value={p.phonePrimary} editing={editing}
              onChange={(v) => setDraft({ ...draft, phonePrimary: v })} />
            <Field label="Phone (secondary)" value={p.phoneSecondary} editing={editing}
              onChange={(v) => setDraft({ ...draft, phoneSecondary: v })} />
            <div className="sm:col-span-2">
              <Field label="Email" value={p.email} editing={editing}
                onChange={(v) => setDraft({ ...draft, email: v })} type="email" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base text-[#1e3a5f]">Insurance</CardTitle>
            <Badge variant={detail.stats.activeInsurance ? "success" : "muted"}>
              {detail.stats.activeInsurance ? "Active" : "Inactive"}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Payer" value={p.payerName} editing={editing}
              onChange={(v) => setDraft({ ...draft, payerName: v })} />
            <Field label="Member ID" value={p.memberId} editing={editing}
              onChange={(v) => setDraft({ ...draft, memberId: v })} />
            <Field label="Plan Name" value={p.insurancePlanName} editing={editing}
              onChange={(v) => setDraft({ ...draft, insurancePlanName: v })} />
            <Field label="Group Number" value={p.insuranceGroupNumber} editing={editing}
              onChange={(v) => setDraft({ ...draft, insuranceGroupNumber: v })} />
            <Field label="Plan Type" value={p.insurancePlanType} editing={editing}
              onChange={(v) => setDraft({ ...draft, insurancePlanType: v })} />
            <Field label="Copay" value={String(p.insuranceCopay || "")} editing={editing}
              onChange={(v) => setDraft({ ...draft, insuranceCopay: parseFloat(v) || 0 })} />
            <Field label="Deductible" value={String(p.insuranceDeductible || "")} editing={editing}
              onChange={(v) => setDraft({ ...draft, insuranceDeductible: parseFloat(v) || 0 })} />
            <Field label="Effective Date" value={p.insuranceEffectiveDate.slice(0, 10)} editing={editing}
              onChange={(v) => setDraft({ ...draft, insuranceEffectiveDate: v })} type="date" />
            {(p.secondaryPayerName || editing) && (
              <>
                <Field label="Secondary Payer" value={p.secondaryPayerName} editing={editing}
                  onChange={(v) => setDraft({ ...draft, secondaryPayerName: v })} />
                <Field label="Secondary Member ID" value={p.secondaryMemberId} editing={editing}
                  onChange={(v) => setDraft({ ...draft, secondaryMemberId: v })} />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base text-[#1e3a5f]">Contacts</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-[#1e3a5f]">Emergency Contact</p>
            <div className="grid gap-3">
              <Field label="Name" value={p.emergencyContactName} editing={editing}
                onChange={(v) => setDraft({ ...draft, emergencyContactName: v })} />
              <Field label="Relationship" value={p.emergencyContactRelationship} editing={editing}
                onChange={(v) => setDraft({ ...draft, emergencyContactRelationship: v })} />
              <Field label="Phone" value={p.emergencyContactPhone} editing={editing}
                onChange={(v) => setDraft({ ...draft, emergencyContactPhone: v })} />
            </div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-[#1e3a5f]">Responsible Party</p>
            {p.responsiblePartyRelationship === "self" && !editing ? (
              <p className="text-sm text-muted-foreground">Patient is responsible party</p>
            ) : (
              <div className="grid gap-3">
                <Field label="Name" value={p.responsiblePartyName} editing={editing}
                  onChange={(v) => setDraft({ ...draft, responsiblePartyName: v })} />
                <Field label="Relationship" value={p.responsiblePartyRelationship} editing={editing}
                  onChange={(v) => setDraft({ ...draft, responsiblePartyRelationship: v })} />
                <Field label="DOB" value={p.responsiblePartyDob.slice(0, 10)} editing={editing}
                  onChange={(v) => setDraft({ ...draft, responsiblePartyDob: v })} type="date" />
                <Field label="Phone" value={p.responsiblePartyPhone} editing={editing}
                  onChange={(v) => setDraft({ ...draft, responsiblePartyPhone: v })} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-[#1e3a5f]">
              <Calendar className="size-4" />
              Upcoming Appointments
            </CardTitle>
            <CardDescription>{upcomingAppts.length} scheduled</CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddAppt((v) => !v)}
          >
            Add Appointment
          </Button>
        </CardHeader>
        <CardContent>
          {showAddAppt && (
            <div className="mb-4 rounded-lg border bg-muted/30 p-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className={labelClass}>Date</p>
                  <input type="date" value={apptDate} onChange={(e) => setApptDate(e.target.value)}
                    className={inputClass} />
                </div>
                <div>
                  <p className={labelClass}>Time</p>
                  <input type="time" value={apptTime} onChange={(e) => setApptTime(e.target.value)}
                    className={inputClass} />
                </div>
                <div>
                  <p className={labelClass}>Provider</p>
                  <input value={apptProvider} onChange={(e) => setApptProvider(e.target.value)}
                    className={inputClass} />
                </div>
                <div>
                  <p className={labelClass}>Type</p>
                  <select value={apptType} onChange={(e) => setApptType(e.target.value)}
                    className={inputClass}>
                    {APPOINTMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{formatAppointmentType(t)}</option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <p className={labelClass}>Notes</p>
                  <Textarea value={apptNotes} onChange={(e) => setApptNotes(e.target.value)} rows={2} />
                </div>
              </div>
              <Button
                size="sm"
                className="mt-3 bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
                disabled={addingAppt || !apptDate}
                onClick={() => void handleAddAppointment()}
              >
                {addingAppt ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                Save Appointment
              </Button>
            </div>
          )}

          {upcomingAppts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No upcoming appointments.</p>
          ) : (
            <div className="space-y-3">
              {upcomingAppts.map((appt) => (
                <div key={appt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-sm">
                      {formatDate(appt.appointmentDate)}
                      {appt.appointmentTime ? ` at ${formatTime(appt.appointmentTime)}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {displayText(appt.providerName)} · {formatAppointmentType(appt.appointmentType)}
                    </p>
                  </div>
                  <span className={badgeClass(appointmentStatusBadge(appt.status))}>
                    {appt.status.replace("_", " ")}
                  </span>
                </div>
              ))}
            </div>
          )}

          {pastAppts.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-[#1e3a5f]"
                onClick={() => setShowPastAppts((v) => !v)}
              >
                <ChevronDown className={cn("size-4 transition-transform", showPastAppts && "rotate-180")} />
                Past Appointments ({pastAppts.length})
              </button>
              {showPastAppts && (
                <div className="mt-3 space-y-2">
                  {pastAppts.map((appt) => (
                    <div key={appt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 opacity-80">
                      <div>
                        <p className="text-sm">{formatDate(appt.appointmentDate)}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatAppointmentType(appt.appointmentType)} · {displayText(appt.providerName)}
                        </p>
                      </div>
                      <span className={badgeClass(appointmentStatusBadge(appt.status))}>
                        {appt.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-[#1e3a5f]">
              <FileText className="size-4" />
              Documents
            </CardTitle>
            <CardDescription>{detail.documents.length} on file</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputClass}>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <input ref={fileInputRef} type="file" className="hidden"
              onChange={(e) => void handleFileSelect(e)} />
            <Button
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Upload className="mr-1 size-4" />
              )}
              Upload Document
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <p className={labelClass}>Upload notes (optional)</p>
            <Textarea value={docNotes} onChange={(e) => setDocNotes(e.target.value)} rows={2}
              placeholder="Brief description of this document…" />
          </div>
          {detail.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
          ) : (
            <div className="space-y-3">
              {detail.documents.map((doc) => (
                <div key={doc.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={badgeClass(documentTypeBadge(doc.documentType))}>
                        {formatDocumentType(doc.documentType)}
                      </span>
                      <span className="text-sm font-medium">{doc.documentName}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Uploaded {formatDate(doc.uploadedAt)}
                      {doc.notes ? ` · ${doc.notes}` : ""}
                    </p>
                  </div>
                  {doc.downloadUrl && (
                    <a
                      href={doc.downloadUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-medium text-[#1e3a5f] hover:underline"
                    >
                      Download
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base text-[#1e3a5f]">Claims History</CardTitle>
          <CardDescription>
            {detail.stats.totalClaims} claims · {formatCurrency(detail.stats.totalBilled)} billed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.claims.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No claims on file for this patient.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Charge</TableHead>
                  <TableHead>Denial Risk</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.claims.map((claim) => {
                  const riskPercent = Math.round((claim.denialRisk ?? 0) * 100);
                  return (
                    <TableRow
                      key={claim.claimId}
                      className="cursor-pointer"
                      onClick={() => router.push(`/claims/${claim.claimId}`)}
                    >
                      <TableCell className="font-mono text-xs">
                        {truncateId(claim.claimId)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(claim.status)}>
                          {formatStatus(claim.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(claim.totalCharge)}
                      </TableCell>
                      <TableCell className="w-36">
                        <div className="h-2 w-full rounded-full bg-gray-200">
                          <div
                            className={cn("h-2 rounded-full", denialRiskColor(riskPercent))}
                            style={{ width: `${riskPercent}%` }}
                          />
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(claim.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
