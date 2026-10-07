import { Request, Response } from "@elements/app";
import { requireFinance } from "#app/shared/services/auth";
import { loadBudgets, loadDepartments, loadPeople } from "#app/shared/services/departments";
import { requestChanges } from "#app/shared/services/requests";
import departments from "./template";

export default function route(req: Request, res: Response) {
  let user = requireFinance();
  let changes = requestChanges.listen();

  return new departments({
    user,
    changes,
    people: loadPeople(),
    initial: loadDepartments(),
    initialBudgets: loadBudgets(),
  });
}
