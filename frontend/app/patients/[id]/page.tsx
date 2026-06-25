"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  ChevronDown,
  CreditCard,
  DollarSign,
  Edit,
  File,
  FileText,
  FlaskConical,
  Loader2,
  Receipt,
  Save,
  ScanLine,
  Share2,
  ShieldCheck,
  Upload,
  Users,
  X,
  type LucideIcon,
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
  statusBadgeClass,
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
import { StatCard } from "@/components/ui/stat-card";
import { CountUp, Reveal, Stagger, StaggerItem } from "@/components/ui/motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const usd0 = (n: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);

const inputClass =
  "h-9 w-full rounded-md border border-input bg-white px-3 text-sm shadow-sm " +
  "focus:outline-none focus:ring-2 focus:ring-brand/40";

const labelClass = "text-xs font-medium text-slate-500";
const thClass = "text-xs font-semibold uppercase tracking-wider text-slate-500";

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

const DOC_ICONS: Record<string, LucideIcon> = {
  lab_result: FlaskConical,
  appointment_note: FileText,
  referral: Share2,
  imaging: ScanLine,
  insurance_card: CreditCard,
  other: File,
};

function docIcon(docType: string): LucideIcon {
  return DOC_ICONS[docType] ?? File;
}

function apptDateParts(value: string): { month: string; day: string } {
  const d = new Date(value.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return { month: "", day: "" };
  return {
    month: d.toLocaleString(undefined, { month: "short" }).toUpperCase(),
    day: String(d.getDate()),
  };
}

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
        <p className="text-sm text-slate-800">{displayText(value) || "—"}</p>
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
    detail?.appointments.filter((a) => a.appointmentDate.slice(0, 10) >= today) ??
    [];
  const pastAppts =
    detail?.appointments.filter((a) => a.appointmentDate.slice(0, 10) < today) ??
    [];

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

  const handleFileSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> => {
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
        <Loader2 className="mr-2 size-5 animate-spin text-brand" />
        Loading patient profile…
      </div>
    );
  }

  if (error && !detail) {
    return <p className="p-8 text-center text-destructive">{error}</p>;
  }

  if (!detail || !draft) {
    return (
      <p className="p-8 text-center text-muted-foreground">Patient not found.</p>
    );
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

      <Reveal className="mb-6">
        <Link
          href="/patients"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-brand"
        >
          <ArrowLeft className="size-3.5" />
          Patients
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-blue-600 font-display text-xl font-bold text-white shadow-lg shadow-blue-500/25 ring-1 ring-white/30">
              {(p.lastName || p.firstName || "?").charAt(0).toUpperCase()}
            </span>
            <div>
              <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
                {fullName}
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                <span>
                  Member ID{" "}
                  <span className="font-mono text-slate-700">
                    {displayText(p.memberId)}
                  </span>
                </span>
                <span className="text-slate-300">·</span>
                <span>{displayText(p.payerName)}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    detail.stats.activeInsurance
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  <ShieldCheck className="size-3" />
                  {detail.stats.activeInsurance ? "Active" : "Inactive"}
                </span>
              </p>
            </div>
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
                  className="bg-brand text-white hover:bg-brand-dark"
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
      </Reveal>

      {/* Patient summary stats */}
      <Stagger className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StaggerItem>
          <StatCard
            label="Total Claims"
            value={<CountUp value={detail.stats.totalClaims} />}
            icon={FileText}
            accent="blue"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Total Billed"
            value={<CountUp value={detail.stats.totalBilled} format={usd0} />}
            icon={DollarSign}
            accent="green"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Patient Responsibility"
            value={
              <CountUp
                value={detail.stats.totalPatientResponsibility}
                format={usd0}
              />
            }
            icon={Receipt}
            accent="amber"
          />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Insurance"
            value={detail.stats.activeInsurance ? "Active" : "Inactive"}
            subtitle={displayText(p.payerName)}
            icon={ShieldCheck}
            accent={detail.stats.activeInsurance ? "green" : "slate"}
          />
        </StaggerItem>
      </Stagger>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <Users className="size-4 text-brand" />
              Demographics
            </CardTitle>
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
                  <p className="text-sm text-slate-800">
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

        {editing ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base text-slate-900">Insurance</CardTitle>
              <Badge variant={detail.stats.activeInsurance ? "success" : "muted"}>
                {detail.stats.activeInsurance ? "Active" : "Inactive"}
              </Badge>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Payer" value={p.payerName} editing
                onChange={(v) => setDraft({ ...draft, payerName: v })} />
              <Field label="Member ID" value={p.memberId} editing
                onChange={(v) => setDraft({ ...draft, memberId: v })} />
              <Field label="Plan Name" value={p.insurancePlanName} editing
                onChange={(v) => setDraft({ ...draft, insurancePlanName: v })} />
              <Field label="Group Number" value={p.insuranceGroupNumber} editing
                onChange={(v) => setDraft({ ...draft, insuranceGroupNumber: v })} />
              <Field label="Plan Type" value={p.insurancePlanType} editing
                onChange={(v) => setDraft({ ...draft, insurancePlanType: v })} />
              <Field label="Copay" value={String(p.insuranceCopay || "")} editing
                onChange={(v) => setDraft({ ...draft, insuranceCopay: parseFloat(v) || 0 })} />
              <Field label="Deductible" value={String(p.insuranceDeductible || "")} editing
                onChange={(v) => setDraft({ ...draft, insuranceDeductible: parseFloat(v) || 0 })} />
              <Field label="Effective Date" value={p.insuranceEffectiveDate.slice(0, 10)} editing
                onChange={(v) => setDraft({ ...draft, insuranceEffectiveDate: v })} type="date" />
              {(p.secondaryPayerName || editing) && (
                <>
                  <Field label="Secondary Payer" value={p.secondaryPayerName} editing
                    onChange={(v) => setDraft({ ...draft, secondaryPayerName: v })} />
                  <Field label="Secondary Member ID" value={p.secondaryMemberId} editing
                    onChange={(v) => setDraft({ ...draft, secondaryMemberId: v })} />
                </>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="mesh-hero grid-overlay relative overflow-hidden rounded-2xl border border-white/10 p-6 text-white shadow-float">
            <span className="accent-glow -right-8 -top-8 size-40 bg-brand/40" aria-hidden />
            <div className="relative flex items-start justify-between">
              <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                <span className="flex size-7 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <CreditCard className="size-4" />
                </span>
                Member Card
              </span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  detail.stats.activeInsurance
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-slate-500/25 text-slate-300",
                )}
              >
                {detail.stats.activeInsurance ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="relative mt-4 font-display text-xl font-semibold tracking-tight text-white">
              {displayText(p.insurancePlanName) === "—"
                ? displayText(p.payerName)
                : p.insurancePlanName}
            </p>
            <p className="relative text-sm text-slate-300">
              {displayText(p.payerName)}
            </p>

            <div className="relative mt-5 grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Member ID
                </p>
                <p className="font-mono text-white">{displayText(p.memberId)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Group Number
                </p>
                <p className="font-mono text-white">
                  {displayText(p.insuranceGroupNumber)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Plan Type
                </p>
                <p className="text-white">{displayText(p.insurancePlanType)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Effective Date
                </p>
                <p className="text-white">
                  {p.insuranceEffectiveDate
                    ? formatDate(p.insuranceEffectiveDate)
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Copay
                </p>
                <p className="text-white">{formatCurrency(p.insuranceCopay)}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Deductible
                </p>
                <p className="text-white">
                  {formatCurrency(p.insuranceDeductible)}
                </p>
              </div>
            </div>

            {p.secondaryPayerName && (
              <div className="relative mt-5 border-t border-white/10 pt-4 text-sm">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Secondary Coverage
                </p>
                <p className="text-white">
                  {p.secondaryPayerName}
                  {p.secondaryMemberId ? (
                    <span className="ml-2 font-mono text-slate-300">
                      {p.secondaryMemberId}
                    </span>
                  ) : null}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <Users className="size-4 text-brand" />
            Contacts
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold text-slate-900">
              Emergency Contact
            </p>
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
            <p className="mb-2 text-sm font-semibold text-slate-900">
              Responsible Party
            </p>
            {p.responsiblePartyRelationship === "self" && !editing ? (
              <p className="text-sm text-muted-foreground">
                Patient is responsible party
              </p>
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
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <Calendar className="size-4 text-brand" />
              Upcoming Appointments
            </CardTitle>
            <CardDescription>{upcomingAppts.length} scheduled</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAddAppt((v) => !v)}>
            Add Appointment
          </Button>
        </CardHeader>
        <CardContent>
          {showAddAppt && (
            <div className="mb-4 rounded-lg border border-border bg-slate-50 p-4">
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
                className="mt-3 bg-brand text-white hover:bg-brand-dark"
                disabled={addingAppt || !apptDate}
                onClick={() => void handleAddAppointment()}
              >
                {addingAppt ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                Save Appointment
              </Button>
            </div>
          )}

          {upcomingAppts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No upcoming appointments.
            </p>
          ) : (
            <div className="space-y-3">
              {upcomingAppts.map((appt) => {
                const { month, day } = apptDateParts(appt.appointmentDate);
                return (
                  <div
                    key={appt.id}
                    className="flex items-center gap-4 rounded-xl border border-slate-200 p-3 transition-colors hover:border-brand/30 hover:bg-slate-50"
                  >
                    <div className="flex w-14 shrink-0 flex-col items-center rounded-xl bg-gradient-to-br from-brand to-brand-dark py-2 text-center text-white shadow-sm shadow-brand/25 ring-1 ring-white/20">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-sky-100">
                        {month}
                      </span>
                      <span className="font-display text-xl font-bold leading-none">
                        {day}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">
                        {appt.appointmentTime
                          ? formatTime(appt.appointmentTime)
                          : "All day"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {displayText(appt.providerName)} ·{" "}
                        {formatAppointmentType(appt.appointmentType)}
                      </p>
                    </div>
                    <span className={badgeClass(appointmentStatusBadge(appt.status))}>
                      {appt.status.replace("_", " ")}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {pastAppts.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-brand"
                onClick={() => setShowPastAppts((v) => !v)}
              >
                <ChevronDown className={cn("size-4 transition-transform", showPastAppts && "rotate-180")} />
                Past Appointments ({pastAppts.length})
              </button>
              {showPastAppts && (
                <div className="mt-3 space-y-2">
                  {pastAppts.map((appt) => (
                    <div key={appt.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3 opacity-80">
                      <div>
                        <p className="text-sm text-slate-800">{formatDate(appt.appointmentDate)}</p>
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
            <CardTitle className="flex items-center gap-2 text-base text-slate-900">
              <FileText className="size-4 text-brand" />
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
            <p className="text-sm text-muted-foreground">
              No documents uploaded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {detail.documents.map((doc) => {
                const DocIcon = docIcon(doc.documentType);
                return (
                  <div
                    key={doc.id}
                    className="group flex items-center gap-3 rounded-xl border border-slate-200 p-3 transition-all hover:border-brand/30 hover:shadow-sm"
                  >
                    <span
                      className={cn(
                        "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                        documentTypeBadge(doc.documentType),
                      )}
                    >
                      <DocIcon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-900">
                          {doc.documentName}
                        </span>
                        <span className={badgeClass(documentTypeBadge(doc.documentType))}>
                          {formatDocumentType(doc.documentType)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Uploaded {formatDate(doc.uploadedAt)}
                        {doc.notes ? ` · ${doc.notes}` : ""}
                      </p>
                    </div>
                    {doc.downloadUrl && (
                      <a
                        href={doc.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:border-brand/40 hover:text-brand"
                      >
                        Download
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-slate-900">
            <FileText className="size-4 text-brand" />
            Claims History
          </CardTitle>
          <CardDescription>
            {detail.stats.totalClaims} claims ·{" "}
            {formatCurrency(detail.stats.totalBilled)} billed
          </CardDescription>
        </CardHeader>
        <CardContent>
          {detail.claims.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No claims on file for this patient.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className={thClass}>Claim ID</TableHead>
                    <TableHead className={thClass}>Status</TableHead>
                    <TableHead className={cn(thClass, "text-right")}>
                      Charge
                    </TableHead>
                    <TableHead className={thClass}>Denial Risk</TableHead>
                    <TableHead className={thClass}>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.claims.map((claim) => {
                    const riskPercent = Math.round((claim.denialRisk ?? 0) * 100);
                    return (
                      <TableRow
                        key={claim.claimId}
                        className="group cursor-pointer odd:bg-white even:bg-slate-50/50 hover:bg-brand/[0.05]"
                        onClick={() => router.push(`/claims/${claim.claimId}`)}
                      >
                        <TableCell>
                          <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-xs text-slate-700 transition-colors group-hover:border-brand/30 group-hover:text-brand-dark">
                            {truncateId(claim.claimId)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={cn(
                              statusBadgeClass(claim.status),
                              claim.status === "needs_review" &&
                                "animate-status-pulse",
                            )}
                          >
                            {formatStatus(claim.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums">
                          {formatCurrency(claim.totalCharge)}
                        </TableCell>
                        <TableCell className="w-40">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className={cn(
                                  "h-2 rounded-full",
                                  denialRiskColor(riskPercent),
                                )}
                                style={{ width: `${riskPercent}%` }}
                              />
                            </div>
                            <span className="w-9 text-right text-xs tabular-nums text-slate-500">
                              {riskPercent}%
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-slate-500">
                          {formatDate(claim.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
