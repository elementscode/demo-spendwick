import { ForbiddenError, Request, Response, sql } from "@elements/app";
import { RequestForm } from "#app/shared/models";
import { currentUser } from "#app/shared/services/auth";
import { loadBudgets, loadDepartments } from "#app/shared/services/departments";
import { requestChanges, viewable } from "#app/shared/services/requests";
import requestForm from "./template";

export default function route(req: Request, res: Response) {
  let user = currentUser();
  let changes = requestChanges.listen();

  let form: RequestForm = {
    id: "",
    item: "",
    vendor: "",
    amount: "",
    departmentId: user.departmentId ?? "",
    category: "",
    reason: "",
    quote: null,
    quoteName: null,
  };

  if (req.params.id) {
    let core = viewable(user, req.params.id);
    if (core.requesterId !== user.id || core.status !== "draft") {
      throw new ForbiddenError("only your own drafts can be edited");
    }

    let row = sql<{
      item: string;
      vendor: string;
      amountCents: number;
      departmentId: string;
      category: string;
      reason: string;
      quoteName: string | null;
    }>(`
      select
        item,
        vendor,
        amountCents,
        departmentId,
        category,
        reason,
        quoteName
      from requests
      where id = ${core.id}
    `).firstOrThrow();

    form = {
      ...form,
      ...row,
      id: core.id,
      amount: (row.amountCents / 100).toFixed(2),
    };
  }

  return new requestForm({
    user,
    changes,
    departments: loadDepartments(),
    initialBudgets: loadBudgets(),
    initial: form,
  });
}
