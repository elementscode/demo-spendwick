import type { File } from "@elements/app";

export type Role = "employee" | "head" | "finance";

export type Status = "draft" | "submitted" | "approved" | "rejected" | "ordered" | "received";

export type Step = "head" | "finance";

export type EventAction = "created" | "edited" | "submitted" | "approved" | "rejected" | "ordered" | "received" | "commented";

export type ApprovalStatus = "waiting" | "pending" | "approved" | "rejected" | "skipped";

export const STATUSES: Status[] = ["draft", "submitted", "approved", "rejected", "ordered", "received"];

export const CATEGORIES = [
  "Software",
  "Hardware",
  "Office supplies",
  "Furniture",
  "Travel",
  "Marketing",
  "Professional services",
  "Training",
];

// Requests above this also need finance, on top of the department head.
export const FINANCE_THRESHOLD_CENTS = 100_000;

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  departmentId: string | null;
  departmentName: string | null;

  // The department this user heads, if any. Heads see its requests.
  headOfId: string | null;
}

export interface Department {
  id: string;
  name: string;
  quarterlyBudgetCents: number;
  headId: string | null;
  headName: string | null;
}

export interface Budget {
  departmentId: string;
  departmentName: string;
  quarter: string;
  budgetCents: number;
  committedCents: number;
  pendingCents: number;
  remainingCents: number;
}

export interface RequestRow {
  id: string;
  number: number;
  item: string;
  vendor: string;
  amountCents: number;
  category: string;
  status: Status;
  departmentId: string;
  departmentName: string;
  requesterId: string;
  requesterName: string;
  createdAt: Date;
  updatedAt: Date;
  submittedAt: Date | null;

  // The step waiting on a decision, when the request is submitted.
  pendingStep: Step | null;
}

export interface Approval {
  id: string;
  step: Step;
  position: number;
  status: ApprovalStatus;
  approverId: string | null;
  approverName: string | null;
  comment: string;
  decidedAt: Date | null;
}

export interface RequestEvent {
  id: string;
  actorName: string | null;
  action: EventAction;
  step: Step | null;
  fromStatus: Status | null;
  toStatus: Status | null;
  comment: string;
  createdAt: Date;
}

export interface RequestDetail extends RequestRow {
  reason: string;
  quoteName: string | null;
  quoteSize: number | null;
  approvals: Approval[];
  events: RequestEvent[];
  budget: Budget;

  // What the signed-in viewer may do to this request right now.
  can: {
    edit: boolean;
    submit: boolean;
    decide: boolean;
    order: boolean;
    receive: boolean;
    comment: boolean;
  };
}

export interface RequestForm {
  id: string;
  item: string;
  vendor: string;
  amount: string;
  departmentId: string;
  category: string;
  reason: string;
  quote: File | null;
  quoteName: string | null;
}

export interface SpendRow {
  label: string;
  committedCents: number;
  pendingCents: number;
  budgetCents: number;
}

export interface FinanceSummary {
  quarter: string;
  totalBudgetCents: number;
  totalCommittedCents: number;
  totalPendingCents: number;
  awaitingFinance: number;
  byDepartment: SpendRow[];
  byCategory: SpendRow[];
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

export function parseAmount(text: string): number {
  let clean = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) {
    return NaN;
  }

  return Math.round(parseFloat(clean) * 100);
}

export function requestNumber(n: number): string {
  return `PR-${n}`;
}

export function statusLabel(s: Status): string {
  return s[0].toUpperCase() + s.slice(1);
}

export function statusIntent(s: Status): string {
  switch (s) {
    case "draft":
      return "";

    case "submitted":
      return "is-warning";

    case "approved":
      return "is-success";

    case "rejected":
      return "is-danger";

    case "ordered":
      return "is-info";

    case "received":
      return "is-accent";
  }
}

export function stepLabel(s: Step): string {
  return s === "head" ? "Department head" : "Finance";
}

export function roleLabel(r: Role): string {
  switch (r) {
    case "employee":
      return "Employee";

    case "head":
      return "Department head";

    case "finance":
      return "Finance";
  }
}

export function shortDate(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function dateTime(d: Date): string {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function quarterStart(at: Date): Date {
  return new Date(at.getFullYear(), Math.floor(at.getMonth() / 3) * 3, 1);
}

export function quarterLabel(at: Date): string {
  return `Q${Math.floor(at.getMonth() / 3) + 1} ${at.getFullYear()}`;
}
