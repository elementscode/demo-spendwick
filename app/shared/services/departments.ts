import { sql, tx, ValidationError } from "@elements/app";
import { Budget, Department, parseAmount } from "#app/shared/models";
import { currentUser, requireFinance } from "#app/shared/services/auth";
import { announce, loadBudget } from "#app/shared/services/requests";

export interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  departmentId: string | null;
}

export interface DepartmentForm {
  id: string;
  name: string;
  budget: string;
  headId: string;
}

export function loadDepartments(): Department[] {
  return sql<Department>(`
    select
      d.id,
      d.name,
      d.quarterlyBudgetCents,
      d.headId,
      u.name as headName
    from departments d
    left join users u on u.id = d.headId
    order by d.name
  `).all();
}

export function loadBudgets(): Budget[] {
  return loadDepartments().map((d) => loadBudget(d.id));
}

export function loadPeople(): Person[] {
  return sql<Person>(`
    select
      id,
      name,
      email,
      role,
      departmentId
    from users
    where role <> 'finance'
    order by name
  `).all();
}

/** @rpc */
export function fetchBudgets(): Budget[] {
  currentUser();

  return loadBudgets();
}

/**
 * Creates or updates a department. Naming a head also moves that person into
 * the department and makes them a head; a head who no longer heads anything
 * goes back to being an employee.
 *
 * @rpc
 */
export function saveDepartment(form: DepartmentForm): Department[] {
  requireFinance();

  let name = form.name.trim();
  let cents = parseAmount(form.budget);
  let errors: Record<string, string[]> = {};

  if (!name) {
    errors.name = ["name the department"];
  }

  if (!(cents >= 0)) {
    errors.budget = ["enter a quarterly budget, like 25000"];
  }

  let clash = sql(`
    select 1
    from departments
    where
      lower(name) = lower(${name})
      and id <> ${form.id || "00000000-0000-0000-0000-000000000000"}
  `).empty();

  if (!clash) {
    errors.name = ["another department already has that name"];
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors);
  }

  let headId = form.headId || null;

  let id = tx(() => {
    let id = form.id;

    if (id) {
      sql(`
        update departments
        set
          name = ${name},
          quarterlyBudgetCents = ${cents},
          headId = ${headId}
        where id = ${id}
      `);
    } else {
      id = sql<{ id: string }>(`
        insert into departments (
          name,
          quarterlyBudgetCents,
          headId
        ) values (
          ${name},
          ${cents},
          ${headId}
        )
        returning id
      `).firstOrThrow().id;
    }

    if (headId) {
      // One person heads one department.
      sql(`
        update departments
        set headId = null
        where
          headId = ${headId}
          and id <> ${id}
      `);

      sql(`
        update users
        set
          role = 'head',
          departmentId = ${id}
        where id = ${headId}
      `);
    }

    sql(`
      update users
      set role = 'employee'
      where
        role = 'head'
        and not exists (select 1 from departments d where d.headId = users.id)
    `);

    return id;
  });

  announce({
    requestId: null,
    departmentId: id,
    requesterId: null,
  });

  return loadDepartments();
}
