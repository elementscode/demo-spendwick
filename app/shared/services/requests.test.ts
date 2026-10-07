import { test, equal, assert, sql, errorf } from "@elements/app";
import { CurrentUser, RequestForm, RequestRow } from "#app/shared/models";
import { loadUser } from "#app/shared/services/auth";
import {
  advanceAs,
  commentAs,
  decideAs,
  loadBudget,
  loadDetail,
  loadInbox,
  loadRows,
  saveRequestAs,
} from "#app/shared/services/requests";

interface World {
  finance: CurrentUser;
  head: CurrentUser;
  employee: CurrentUser;
  other: CurrentUser;
  otherHead: CurrentUser;
  deptId: string;
  otherDeptId: string;
}

function person(email: string, role: string, departmentId: string | null): string {
  return sql<{ id: string }>(`
    insert into users (
      email,
      name,
      role,
      departmentId,
      passwordHash
    ) values (
      ${email},
      ${email.split("@")[0]},
      ${role},
      ${departmentId},
      'x'
    )
    returning id
  `).firstOrThrow().id;
}

function department(name: string, budgetCents: number): string {
  return sql<{ id: string }>(`
    insert into departments (
      name,
      quarterlyBudgetCents
    ) values (
      ${name},
      ${budgetCents}
    )
    returning id
  `).firstOrThrow().id;
}

function setHead(deptId: string, userId: string) {
  sql(`
    update departments
    set headId = ${userId}
    where id = ${deptId}
  `);
}

// Department names and emails are unique, so a world never collides with the
// seeded departments and accounts that share the test database.
let worlds = 0;

function world(): World {
  let tag = `${Date.now().toString(36)}-${++worlds}`;
  let deptId = department(`Engineering ${tag}`, 500000);
  let otherDeptId = department(`Sales ${tag}`, 500000);
  let financeId = person(`fin-${tag}@t.example`, "finance", null);
  let headId = person(`head-${tag}@t.example`, "head", deptId);
  let employeeId = person(`emp-${tag}@t.example`, "employee", deptId);
  let otherId = person(`other-${tag}@t.example`, "employee", deptId);
  let otherHeadId = person(`sales-${tag}@t.example`, "head", otherDeptId);
  setHead(deptId, headId);
  setHead(otherDeptId, otherHeadId);

  return {
    finance: loadUser(financeId)!,
    head: loadUser(headId)!,
    employee: loadUser(employeeId)!,
    other: loadUser(otherId)!,
    otherHead: loadUser(otherHeadId)!,
    deptId,
    otherDeptId,
  };
}

function form(deptId: string, amount: string): RequestForm {
  return {
    id: "",
    item: "Monitor",
    vendor: "Dell",
    amount,
    departmentId: deptId,
    category: "Hardware",
    reason: "Second screen",
    quote: null,
    quoteName: null,
  };
}

// Finance sees every department, including the seeded ones, so finance-wide
// reads are narrowed to this world's departments.
function inWorld(w: World, rows: RequestRow[]): RequestRow[] {
  return rows.filter((r) => r.departmentId === w.deptId || r.departmentId === w.otherDeptId);
}

// The quarter the request was submitted in, so a test running across a
// quarter boundary still reads the budget its rows landed in.
function submittedAt(id: string): Date {
  return sql<{ submittedAt: Date }>(`
    select submittedAt
    from requests
    where id = ${id}
  `).firstOrThrow().submittedAt;
}

function chain(user: CurrentUser, id: string): string {
  return loadDetail(user, id).approvals.map((a) => `${a.step}:${a.status}`).join(",");
}

async function throws(label: string, fn: () => unknown) {
  try {
    await fn();
    errorf("%v: expected an error", label);
  } catch (err) {
    assert(!!err, label);
  }
}

test("approvals", async () => {
  test("a request at or under $1,000 needs only the department head", async () => {
    let w = world();
    let id = saveRequestAs(w.employee, form(w.deptId, "1000"), true);

    equal(chain(w.employee, id), "head:pending");
    equal(loadInbox(w.head).map((r) => r.id), [id]);
    equal(inWorld(w, loadInbox(w.finance)).length, 0);

    decideAs(w.head, id, "approved", "");
    equal(loadDetail(w.employee, id).status, "approved");
    equal(chain(w.employee, id), "head:approved");
  });

  test("a request over $1,000 needs the head, then finance", async () => {
    let w = world();
    let id = saveRequestAs(w.employee, form(w.deptId, "1,000.01"), true);

    equal(chain(w.employee, id), "head:pending,finance:waiting");
    await throws("finance cannot jump ahead of the head", () => decideAs(w.finance, id, "approved", ""));

    decideAs(w.head, id, "approved", "ok");
    equal(loadDetail(w.employee, id).status, "submitted");
    equal(chain(w.employee, id), "head:approved,finance:pending");
    equal(inWorld(w, loadInbox(w.finance)).map((r) => r.id), [id]);

    decideAs(w.finance, id, "approved", "");
    equal(loadDetail(w.employee, id).status, "approved");
  });

  test("a head's own request goes to finance instead", async () => {
    let w = world();
    let id = saveRequestAs(w.head, form(w.deptId, "50"), true);

    equal(chain(w.head, id), "head:skipped,finance:pending");
    equal(loadInbox(w.head).length, 0);
  });

  test("rejecting needs a comment and ends the chain", async () => {
    let w = world();
    let id = saveRequestAs(w.employee, form(w.deptId, "2500"), true);

    await throws("reject without a comment", () => decideAs(w.head, id, "rejected", "  "));
    decideAs(w.head, id, "rejected", "Use the spare one");

    let d = loadDetail(w.employee, id);
    equal(d.status, "rejected");
    equal(chain(w.employee, id), "head:rejected,finance:skipped");
    equal(d.events.at(-1)?.comment, "Use the spare one");
  });

  test("only the right approver decides", async () => {
    let w = world();
    let id = saveRequestAs(w.employee, form(w.deptId, "300"), true);

    await throws("an employee", () => decideAs(w.other, id, "approved", ""));
    await throws("another department's head", () => decideAs(w.otherHead, id, "approved", ""));
    await throws("the requester", () => decideAs(w.employee, id, "approved", ""));
  });

  test("history records every status change and comment", async () => {
    let w = world();
    let id = saveRequestAs(w.employee, form(w.deptId, "300"), false);
    saveRequestAs(w.employee, { ...form(w.deptId, "320"), id }, true);
    commentAs(w.head, id, "Which model?");
    decideAs(w.head, id, "approved", "");
    advanceAs(w.finance, id, "ordered", "PO 1182");
    advanceAs(w.employee, id, "received", "");

    let d = loadDetail(w.employee, id);
    equal(d.events.map((e) => e.action), ["created", "edited", "submitted", "commented", "approved", "ordered", "received"]);
    equal(d.status, "received");
    equal(d.amountCents, 32000);
  });

  test("only finance places the order", async () => {
    let w = world();
    let id = saveRequestAs(w.employee, form(w.deptId, "300"), true);
    decideAs(w.head, id, "approved", "");

    await throws("an employee", () => advanceAs(w.employee, id, "ordered", ""));
    advanceAs(w.finance, id, "ordered", "");
    equal(loadDetail(w.finance, id).status, "ordered");
  });

  test("validation reports each bad field", async () => {
    let w = world();

    try {
      saveRequestAs(w.employee, { ...form(w.deptId, "abc"), item: "", category: "Snacks" }, false);
      errorf("expected a validation error");
    } catch (err: any) {
      equal(Object.keys(err.errors).sort(), ["amount", "category", "item"]);
    }
  });
});

test("visibility", async () => {
  test("employees see only their own requests", async () => {
    let w = world();
    let mine = saveRequestAs(w.employee, form(w.deptId, "100"), true);
    let theirs = saveRequestAs(w.other, form(w.deptId, "100"), true);

    equal(loadRows(w.employee).map((r) => r.id), [mine]);
    await throws("another employee's request", () => loadDetail(w.employee, theirs));
  });

  test("heads see their department's submitted requests, not drafts or other departments", async () => {
    let w = world();
    let submitted = saveRequestAs(w.employee, form(w.deptId, "100"), true);
    saveRequestAs(w.employee, form(w.deptId, "100"), false);
    saveRequestAs(w.otherHead, form(w.otherDeptId, "100"), true);

    equal(loadRows(w.head).map((r) => r.id), [submitted]);
  });

  test("finance sees everything", async () => {
    let w = world();
    saveRequestAs(w.employee, form(w.deptId, "100"), true);
    saveRequestAs(w.otherHead, form(w.otherDeptId, "100"), true);

    equal(inWorld(w, loadRows(w.finance)).length, 2);
  });
});

test("budget", async () => {
  test("approved spend is committed and submitted spend is pending", async () => {
    let w = world();
    let a = saveRequestAs(w.employee, form(w.deptId, "400"), true);
    saveRequestAs(w.employee, form(w.deptId, "250"), true);
    saveRequestAs(w.employee, form(w.deptId, "999"), false);
    decideAs(w.head, a, "approved", "");

    let b = loadBudget(w.deptId, submittedAt(a));
    equal(b.budgetCents, 500000);
    equal(b.committedCents, 40000);
    equal(b.pendingCents, 25000);
    equal(b.remainingCents, 460000);
  });

  test("rejected spend does not count", async () => {
    let w = world();
    let a = saveRequestAs(w.employee, form(w.deptId, "400"), true);
    decideAs(w.head, a, "rejected", "no");

    let b = loadBudget(w.deptId, submittedAt(a));
    equal(b.committedCents + b.pendingCents, 0);
  });
});
