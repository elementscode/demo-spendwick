import { Request, Response } from "@elements/app";
import { requireFinance } from "#app/shared/services/auth";
import { loadDepartments } from "#app/shared/services/departments";
import { loadSummary } from "#app/shared/services/finance";
import { loadRows, requestChanges } from "#app/shared/services/requests";
import finance from "./template";

export default function route(req: Request, res: Response) {
  let user = requireFinance();
  let changes = requestChanges.listen();

  return new finance({
    user,
    changes,
    departments: loadDepartments(),
    initial: {
      summary: loadSummary(),
      rows: loadRows(user),
    },
  });
}
