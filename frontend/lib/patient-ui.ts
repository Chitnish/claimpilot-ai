import { cn } from "@/lib/utils";

export function appointmentStatusBadge(status: string): string {
  switch (status) {
    case "scheduled":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "completed":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    case "cancelled":
      return "border-gray-200 bg-gray-100 text-gray-600";
    case "no_show":
      return "border-red-200 bg-red-100 text-red-800";
    default:
      return "border-gray-200 bg-gray-100 text-gray-600";
  }
}

export function documentTypeBadge(docType: string): string {
  switch (docType) {
    case "lab_result":
      return "border-purple-200 bg-purple-100 text-purple-800";
    case "appointment_note":
      return "border-blue-200 bg-blue-100 text-blue-800";
    case "referral":
      return "border-teal-200 bg-teal-100 text-teal-800";
    case "imaging":
      return "border-orange-200 bg-orange-100 text-orange-800";
    case "insurance_card":
      return "border-emerald-200 bg-emerald-100 text-emerald-800";
    default:
      return "border-gray-200 bg-gray-100 text-gray-600";
  }
}

export function formatDocumentType(docType: string): string {
  return docType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatAppointmentType(apptType: string): string {
  return apptType
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatDate(value: string): string {
  if (!value) return "—";
  const d = new Date(value.slice(0, 10) + "T12:00:00");
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

export function formatTime(value: string): string {
  if (!value) return "";
  const parts = value.split(":");
  if (parts.length < 2) return value;
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parts[1] ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12}:${m} ${ampm}`;
}

export function patientFullName(first: string, last: string, middle?: string): string {
  const mid = middle ? ` ${middle}` : "";
  return `${first}${mid} ${last}`.trim();
}

export function formatAddress(
  line1: string,
  line2: string,
  city: string,
  state: string,
  zip: string,
): string {
  const parts = [line1, line2, [city, state].filter(Boolean).join(", "), zip].filter(Boolean);
  return parts.join(", ") || "—";
}

export function badgeClass(className: string): string {
  return cn("inline-flex rounded-full border px-2 py-0.5 text-xs font-medium", className);
}
