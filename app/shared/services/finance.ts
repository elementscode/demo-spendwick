import { sql } from "@elements/app";
import { FinanceSummary, RequestRow, SpendRow } from "#app/shared/models";
import { requireFinance } from "#app/shared/services/auth";
import { loadRows, quarterLabel, quarterStart } from "#app/shared/services/requests";

export interface ExportRow {
  number: number;
  createdAt: Date;
  submittedAt: Date | null;
  requesterName: string;
  requesterEmail: string;
  departmentName: string;
  category: string;
  item: string;
  vendor: string;
  amountCents: number;
  status: string;
  headApprover: string | null;
  financeApprover: string | null;
  reason: string;
}

export function loadSummary(at: Date = new Date()): FinanceSummary {
  let start = quarterStart(at);
  let end = new Date(start.getFullYear(), start.getMonth() + 3, 1);

  let byDepartment = sql<SpendRow>(`
    select
      d.name as label,
      d.quarterlyBudgetCents as budgetCents,
      coalesce(sum(r.amountCents) filter (where r.status in ('approved', 'ordered', 'received')), 0)::int as committedCents,
      coalesce(sum(r.amountCents) filter (where r.status = 'submitted'), 0)::int as pendingCents
    from departments d
    left join requests r on
      r.departmentId = d.id
      and r.submittedAt >= ${start}
      and r.submittedAt < ${end}
    group by d.id
    order by d.name
  `).all();

  let byCategory = sql<SpendRow>(`
    select
      r.category as label,
      0 as budgetCents,
      coalesce(sum(r.amountCents) filter (where r.status in ('approved', 'ordered', 'received')), 0)::int as committedCents,
      coalesce(sum(r.amountCents) filter (where r.status = 'submitted'), 0)::int as pendingCents
    from requests r
    where
      r.submittedAt >= ${start}
      and r.submittedAt < ${end}
      and r.status in ('submitted', 'approved', 'ordered', 'received')
    group by r.category
    order by
      committedCents desc,
      pendingCents desc
  `).all();

  let awaiting = sql<{ n: number }>(`
    select count(*)::int as n
    from approvals a
    join requests r on r.id = a.requestId
    where
      a.step = 'finance'
      and a.status = 'pending'
      and r.status = 'submitted'
  `).firstOrThrow();

  return {
    quarter: quarterLabel(start),
    totalBudgetCents: byDepartment.reduce((n, d) => n + d.budgetCents, 0),
    totalCommittedCents: byDepartment.reduce((n, d) => n + d.committedCents, 0),
    totalPendingCents: byDepartment.reduce((n, d) => n + d.pendingCents, 0),
    awaitingFinance: awaiting.n,
    byDepartment,
    byCategory,
  };
}

export interface FinancePage {
  summary: FinanceSummary;
  rows: RequestRow[];
}

/** @rpc */
export function fetchFinancePage(): FinancePage {
  let user = requireFinance();

  return {
    summary: loadSummary(),
    rows: loadRows(user),
  };
}

export function loadExport(status: string, departmentId: string, quarter: boolean): ExportRow[] {
  let start = quarterStart(new Date());

  return sql<ExportRow>(`
    select
      r.number,
      r.createdAt,
      r.submittedAt,
      u.name as requesterName,
      u.email as requesterEmail,
      d.name as departmentName,
      r.category,
      r.item,
      r.vendor,
      r.amountCents,
      r.status,
      (select hu.name from approvals a join users hu on hu.id = a.approverId where a.requestId = r.id and a.step = 'head' and a.status in ('approved', 'rejected')) as headApprover,
      (select fu.name from approvals a join users fu on fu.id = a.approverId where a.requestId = r.id and a.step = 'finance' and a.status in ('approved', 'rejected')) as financeApprover,
      r.reason
    from requests r
    join departments d on d.id = r.departmentId
    join users u on u.id = r.requesterId
    where
      r.status <> 'draft'
      and (${status} = '' or r.status = ${status})
      and (${departmentId} = '' or r.departmentId::text = ${departmentId})
      and (not ${quarter} or r.submittedAt >= ${start})
    order by r.number
  `).all();
}

function cell(v: string | number | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) {
    // Spreadsheets run a cell that starts like a formula.
    s = `'${s}`;
  }

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  let head = ["Request", "Submitted", "Requester", "Email", "Department", "Category", "Item", "Vendor", "Amount", "Status", "Head approver", "Finance approver", "Reason"];
  let lines = rows.map((r) => [
    `PR-${r.number}`,
    r.submittedAt ? r.submittedAt.toISOString().slice(0, 10) : "",
    r.requesterName,
    r.requesterEmail,
    r.departmentName,
    r.category,
    r.item,
    r.vendor,
    (r.amountCents / 100).toFixed(2),
    r.status,
    r.headApprover,
    r.financeApprover,
    r.reason,
  ].map(cell).join(","));

  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}
