import {
  sql,
  tx,
  redirect,
  Channel,
  File,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@elements/app";
import {
  Approval,
  Budget,
  CATEGORIES,
  CurrentUser,
  EventAction,
  FINANCE_THRESHOLD_CENTS,
  RequestDetail,
  RequestEvent,
  RequestForm,
  RequestRow,
  Status,
  Step,
  parseAmount,
  quarterLabel,
  quarterStart,
} from "#app/shared/models";

export { quarterLabel, quarterStart };
import { currentUser } from "#app/shared/services/auth";
import { RequestEmailJob } from "#app/jobs/request-email";

export interface RequestChange {
  requestId: string | null;
  departmentId: string | null;
  requesterId: string | null;
}

// A "something changed" signal. Each page re-reads its own slice through an
// rpc, so the visibility rules run on every refresh rather than in a payload.
export const requestChanges = new Channel<RequestChange>("requestChanges");

export const QUOTE_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
]);

const MAX_QUOTE_BYTES = 10 * 1024 * 1024;

export interface RequestsPage {
  rows: RequestRow[];
  inbox: RequestRow[];
  budget: Budget | null;
}

interface RequestCore {
  id: string;
  number: number;
  requesterId: string;
  departmentId: string;
  amountCents: number;
  status: Status;
  submittedAt: Date | null;
}

export function announce(change: RequestChange) {
  requestChanges.notify(change);
}

export function loadBudget(departmentId: string, at: Date = new Date()): Budget {
  let start = quarterStart(at);
  let end = new Date(start.getFullYear(), start.getMonth() + 3, 1);

  let row = sql<Omit<Budget, "quarter" | "remainingCents">>(`
    select
      d.id as departmentId,
      d.name as departmentName,
      d.quarterlyBudgetCents as budgetCents,
      coalesce(sum(r.amountCents) filter (where r.status in ('approved', 'ordered', 'received')), 0)::int as committedCents,
      coalesce(sum(r.amountCents) filter (where r.status = 'submitted'), 0)::int as pendingCents
    from departments d
    left join requests r on
      r.departmentId = d.id
      and r.submittedAt >= ${start}
      and r.submittedAt < ${end}
    where d.id = ${departmentId}
    group by d.id
  `).firstOrThrow(new NotFoundError("department not found"));

  return {
    ...row,
    quarter: quarterLabel(start),
    remainingCents: row.budgetCents - row.committedCents,
  };
}

const ROW_COLUMNS = sql.raw(`
  r.id,
  r.number,
  r.item,
  r.vendor,
  r.amountCents,
  r.category,
  r.status,
  r.departmentId,
  d.name as departmentName,
  r.requesterId,
  u.name as requesterName,
  r.createdAt,
  r.updatedAt,
  r.submittedAt,
  (
    select a.step
    from approvals a
    where
      a.requestId = r.id
      and a.status = 'pending'
    limit 1
  ) as pendingStep
`);

export function loadRows(user: CurrentUser): RequestRow[] {
  return sql<RequestRow>(`
    select ${ROW_COLUMNS}
    from requests r
    join departments d on d.id = r.departmentId
    join users u on u.id = r.requesterId
    where
      ${user.role === "finance"}
      or r.requesterId = ${user.id}
      or (r.departmentId = ${user.headOfId} and r.status <> 'draft')
    order by r.number desc
  `).all();
}

// Requests whose current step is waiting on this user.
export function loadInbox(user: CurrentUser): RequestRow[] {
  return sql<RequestRow>(`
    select ${ROW_COLUMNS}
    from requests r
    join departments d on d.id = r.departmentId
    join users u on u.id = r.requesterId
    join approvals a on
      a.requestId = r.id
      and a.status = 'pending'
    where
      r.status = 'submitted'
      and r.requesterId <> ${user.id}
      and (
        (a.step = 'head' and d.headId = ${user.id})
        or (a.step = 'finance' and ${user.role === "finance"})
      )
    order by r.submittedAt
  `).all();
}

export function loadRequestsPage(user: CurrentUser): RequestsPage {
  let budgetDept = user.headOfId ?? (user.role === "employee" ? null : user.departmentId);

  return {
    rows: loadRows(user),
    inbox: loadInbox(user),
    budget: budgetDept ? loadBudget(budgetDept) : null,
  };
}

function loadCore(id: string): RequestCore {
  return sql<RequestCore>(`
    select
      id,
      number,
      requesterId,
      departmentId,
      amountCents,
      status,
      submittedAt
    from requests
    where id = ${id}
  `).firstOrThrow(new NotFoundError("request not found"));
}

export function canView(user: CurrentUser, r: RequestCore): boolean {
  if (user.role === "finance" || r.requesterId === user.id) {
    return true;
  }

  return r.departmentId === user.headOfId && r.status !== "draft";
}

export function viewable(user: CurrentUser, id: string): RequestCore {
  let r = loadCore(id);
  if (!canView(user, r)) {
    throw new NotFoundError("request not found");
  }

  return r;
}

function headOf(departmentId: string): string | null {
  return sql<{ headId: string | null }>(`
    select headId
    from departments
    where id = ${departmentId}
  `).firstOrThrow(new NotFoundError("department not found")).headId;
}

function loadApprovals(requestId: string): Approval[] {
  return sql<Approval>(`
    select
      a.id,
      a.step,
      a.position,
      a.status,
      a.approverId,
      u.name as approverName,
      a.comment,
      a.decidedAt
    from approvals a
    left join users u on u.id = a.approverId
    where a.requestId = ${requestId}
    order by a.position
  `).all();
}

// A draft has no chain yet. Show who it will go to, so the requester knows
// before they submit.
function previewChain(r: RequestCore): Approval[] {
  let dept = sql<{ headId: string | null; headName: string | null }>(`
    select
      d.headId,
      u.name as headName
    from departments d
    left join users u on u.id = d.headId
    where d.id = ${r.departmentId}
  `).firstOrThrow();

  let skipHead = !dept.headId || dept.headId === r.requesterId;
  let chain: Approval[] = [{
    id: "preview-head",
    step: "head",
    position: 1,
    status: skipHead ? "skipped" : "waiting",
    approverId: dept.headId,
    approverName: dept.headName,
    comment: skipHead ? skipReason(dept.headId) : "",
    decidedAt: null,
  }];

  if (skipHead || r.amountCents > FINANCE_THRESHOLD_CENTS) {
    chain.push({
      id: "preview-finance",
      step: "finance",
      position: 2,
      status: "waiting",
      approverId: null,
      approverName: null,
      comment: "",
      decidedAt: null,
    });
  }

  return chain;
}

function skipReason(headId: string | null): string {
  return headId ? "The requester heads this department, so finance approves instead." : "This department has no head, so finance approves instead.";
}

export function loadDetail(user: CurrentUser, id: string): RequestDetail {
  let core = viewable(user, id);

  let row = sql<RequestRow & {
    reason: string;
    quoteName: string | null;
    quoteSize: number | null;
  }>(`
    select
      ${ROW_COLUMNS},
      r.reason,
      r.quoteName,
      r.quoteSize
    from requests r
    join departments d on d.id = r.departmentId
    join users u on u.id = r.requesterId
    where r.id = ${id}
  `).firstOrThrow();

  let events = sql<RequestEvent>(`
    select
      e.id,
      u.name as actorName,
      e.action,
      e.step,
      e.fromStatus,
      e.toStatus,
      e.comment,
      e.createdAt
    from requestEvents e
    left join users u on u.id = e.actorId
    where e.requestId = ${id}
    order by
      e.createdAt,
      e.id
  `).all();

  let approvals = core.status === "draft" ? previewChain(core) : loadApprovals(id);
  let mine = core.requesterId === user.id;
  let pending = approvals.find((a) => a.status === "pending");

  return {
    ...row,
    approvals,
    events,
    budget: loadBudget(core.departmentId, core.submittedAt ?? new Date()),
    can: {
      edit: mine && core.status === "draft",
      submit: mine && core.status === "draft",
      decide: core.status === "submitted" && !!pending && !mine && canDecide(user, pending.step, core.departmentId),
      order: core.status === "approved" && user.role === "finance",
      receive: core.status === "ordered" && (mine || user.role === "finance"),
      comment: core.status !== "draft",
    },
  };
}

function canDecide(user: CurrentUser, step: Step, departmentId: string): boolean {
  if (step === "finance") {
    return user.role === "finance";
  }

  return headOf(departmentId) === user.id;
}

function logEvent(
  requestId: string,
  actorId: string,
  action: EventAction,
  step: Step | null,
  fromStatus: Status | null,
  toStatus: Status | null,
  comment: string,
) {
  sql(`
    insert into requestEvents (
      requestId,
      actorId,
      action,
      step,
      fromStatus,
      toStatus,
      comment
    ) values (
      ${requestId},
      ${actorId},
      ${action},
      ${step},
      ${fromStatus},
      ${toStatus},
      ${comment}
    )
  `);
}

function setStatus(id: string, status: Status) {
  sql(`
    update requests
    set status = ${status}
    where id = ${id}
  `);
}

function insertApproval(requestId: string, step: Step, position: number, status: string, approverId: string | null, comment: string) {
  sql(`
    insert into approvals (
      requestId,
      step,
      position,
      status,
      approverId,
      comment
    ) values (
      ${requestId},
      ${step},
      ${position},
      ${status},
      ${approverId},
      ${comment}
    )
  `);
}

// Builds the chain for a request being submitted and returns the step that
// now waits on someone. Runs inside the submitting transaction.
function openChain(r: RequestCore): Step {
  let headId = headOf(r.departmentId);
  let skipHead = !headId || headId === r.requesterId;
  let needsFinance = skipHead || r.amountCents > FINANCE_THRESHOLD_CENTS;

  insertApproval(r.id, "head", 1, skipHead ? "skipped" : "pending", headId, skipHead ? skipReason(headId) : "");

  if (needsFinance) {
    insertApproval(r.id, "finance", 2, skipHead ? "pending" : "waiting", null, "");
  }

  return skipHead ? "finance" : "head";
}

function submitInTx(user: CurrentUser, r: RequestCore) {
  if (r.requesterId !== user.id) {
    throw new ForbiddenError("only the requester can submit this request");
  }

  if (r.status !== "draft") {
    throw new ValidationError("this request has already been submitted");
  }

  sql(`
    update requests
    set
      status = 'submitted',
      submittedAt = now()
    where id = ${r.id}
  `);

  logEvent(r.id, user.id, "submitted", null, "draft", "submitted", "");

  let step = openChain(r);
  new RequestEmailJob({
    kind: "needs-approval",
    requestId: r.id,
    step,
  }).schedule();
}

function validate(form: RequestForm): { amountCents: number } {
  let errors: Record<string, string[]> = {};
  let amountCents = parseAmount(form.amount ?? "");

  if (!form.item?.trim()) {
    errors.item = ["describe what you are buying"];
  }

  if (!form.vendor?.trim()) {
    errors.vendor = ["name the vendor"];
  }

  if (!(amountCents > 0)) {
    errors.amount = ["enter an amount, like 1250.00"];
  } else if (amountCents > 10_000_000_00) {
    errors.amount = ["that amount is too large for a purchase request"];
  }

  if (!CATEGORIES.includes(form.category)) {
    errors.category = ["pick a category"];
  }

  let dept = sql(`
    select 1
    from departments
    where id = ${form.departmentId || null}
  `).empty();

  if (dept) {
    errors.departmentId = ["pick a department"];
  }

  if (form.quote) {
    if (!QUOTE_TYPES.has(form.quote.contentType)) {
      errors.quote = ["attach a PDF, image or text file"];
    } else if (form.quote.size > MAX_QUOTE_BYTES) {
      errors.quote = ["the quote must be under 10 MB"];
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  return { amountCents };
}

export function saveRequestAs(user: CurrentUser, form: RequestForm, submit: boolean): string {
  let { amountCents } = validate(form);
  let quote: File | null = form.quote ?? null;

  let id = tx(() => {
    let id = form.id;

    if (id) {
      let existing = viewable(user, id);
      if (existing.requesterId !== user.id || existing.status !== "draft") {
        throw new ForbiddenError("only a draft can be edited, by its requester");
      }

      sql(`
        update requests
        set
          item = ${form.item.trim()},
          vendor = ${form.vendor.trim()},
          amountCents = ${amountCents},
          departmentId = ${form.departmentId},
          category = ${form.category},
          reason = ${form.reason.trim()}
        where id = ${id}
      `);

      logEvent(id, user.id, "edited", null, null, null, "");
    } else {
      id = sql<{ id: string }>(`
        insert into requests (
          requesterId,
          departmentId,
          item,
          vendor,
          amountCents,
          category,
          reason
        ) values (
          ${user.id},
          ${form.departmentId},
          ${form.item.trim()},
          ${form.vendor.trim()},
          ${amountCents},
          ${form.category},
          ${form.reason.trim()}
        )
        returning id
      `).firstOrThrow().id;

      logEvent(id, user.id, "created", null, null, "draft", "");
    }

    if (quote) {
      sql(`
        update requests
        set
          quoteName = ${quote.name},
          quoteContentType = ${quote.contentType},
          quoteSize = ${quote.size},
          quoteData = ${quote.data}
        where id = ${id}
      `);
    }

    if (submit) {
      submitInTx(user, loadCore(id));
    }

    return id;
  });

  announce({
    requestId: id,
    departmentId: form.departmentId,
    requesterId: user.id,
  });

  return id;
}

export function decideAs(user: CurrentUser, id: string, decision: "approved" | "rejected", comment: string) {
  let text = comment.trim();
  if (decision === "rejected" && !text) {
    throw new ValidationError({ comment: ["say why you are rejecting it"] });
  }

  let r = tx(() => {
    let r = viewable(user, id);
    sql(`
      select id
      from requests
      where id = ${id}
      for update
    `);

    if (r.status !== "submitted") {
      throw new ValidationError("this request is not waiting on a decision");
    }

    let pending = sql<{ id: string; step: Step }>(`
      select
        id,
        step
      from approvals
      where
        requestId = ${id}
        and status = 'pending'
    `).firstOrThrow(new ValidationError("this request is not waiting on a decision"));

    if (r.requesterId === user.id || !canDecide(user, pending.step, r.departmentId)) {
      throw new ForbiddenError("this step is not yours to decide");
    }

    sql(`
      update approvals
      set
        status = ${decision},
        approverId = ${user.id},
        comment = ${text},
        decidedAt = now()
      where id = ${pending.id}
    `);

    let next = decision === "approved" ? sql<{ id: string; step: Step }>(`
      select
        id,
        step
      from approvals
      where
        requestId = ${id}
        and status = 'waiting'
      order by position
      limit 1
    `).first() : undefined;

    if (decision === "rejected") {
      sql(`
        update approvals
        set status = 'skipped'
        where
          requestId = ${id}
          and status = 'waiting'
      `);

      setStatus(id, "rejected");
      logEvent(id, user.id, "rejected", pending.step, "submitted", "rejected", text);
    } else if (next) {
      sql(`
        update approvals
        set status = 'pending'
        where id = ${next.id}
      `);

      logEvent(id, user.id, "approved", pending.step, null, null, text);
      new RequestEmailJob({
        kind: "needs-approval",
        requestId: id,
        step: next.step,
      }).schedule();
    } else {
      setStatus(id, "approved");
      logEvent(id, user.id, "approved", pending.step, "submitted", "approved", text);
    }

    new RequestEmailJob({
      kind: "decision",
      requestId: id,
      step: pending.step,
      decision,
      approverName: user.name,
      comment: text,
      final: decision === "rejected" || !next,
    }).schedule();

    return r;
  });

  announce({
    requestId: id,
    departmentId: r.departmentId,
    requesterId: r.requesterId,
  });
}

export function advanceAs(user: CurrentUser, id: string, to: "ordered" | "received", comment: string) {
  let r = tx(() => {
    let r = viewable(user, id);

    if (to === "ordered" && (user.role !== "finance" || r.status !== "approved")) {
      throw new ForbiddenError("finance marks an approved request as ordered");
    }

    if (to === "received" && (r.status !== "ordered" || (r.requesterId !== user.id && user.role !== "finance"))) {
      throw new ForbiddenError("the requester or finance marks an ordered request as received");
    }

    setStatus(id, to);
    logEvent(id, user.id, to, null, r.status, to, comment.trim());

    return r;
  });

  announce({
    requestId: id,
    departmentId: r.departmentId,
    requesterId: r.requesterId,
  });
}

export function commentAs(user: CurrentUser, id: string, comment: string) {
  let text = comment.trim();
  if (!text) {
    throw new ValidationError({ comment: ["write a comment first"] });
  }

  let r = viewable(user, id);
  if (r.status === "draft") {
    throw new ValidationError("submit the request before commenting");
  }

  logEvent(id, user.id, "commented", null, null, null, text);

  announce({
    requestId: id,
    departmentId: r.departmentId,
    requesterId: r.requesterId,
  });
}

/** @rpc */
export function fetchRequestsPage(): RequestsPage {
  return loadRequestsPage(currentUser());
}

/** @rpc */
export function fetchDetail(id: string): RequestDetail {
  return loadDetail(currentUser(), id);
}

/** @rpc */
export function fetchBudget(departmentId: string): Budget {
  currentUser();

  return loadBudget(departmentId);
}

/** @rpc */
export function saveRequest(form: RequestForm, submit: boolean) {
  let id = saveRequestAs(currentUser(), form, submit);

  redirect(`/requests/${id}`);
}

/** @rpc */
export function submitRequest(id: string): RequestDetail {
  let user = currentUser();
  let r = tx(() => {
    let r = viewable(user, id);
    submitInTx(user, r);

    return r;
  });

  announce({
    requestId: id,
    departmentId: r.departmentId,
    requesterId: r.requesterId,
  });

  return loadDetail(user, id);
}

/** @rpc */
export function decide(id: string, decision: "approved" | "rejected", comment: string): RequestDetail {
  let user = currentUser();
  decideAs(user, id, decision, comment);

  return loadDetail(user, id);
}

/** @rpc */
export function advance(id: string, to: "ordered" | "received", comment: string): RequestDetail {
  let user = currentUser();
  advanceAs(user, id, to, comment);

  return loadDetail(user, id);
}

/** @rpc */
export function comment(id: string, text: string): RequestDetail {
  let user = currentUser();
  commentAs(user, id, text);

  return loadDetail(user, id);
}
