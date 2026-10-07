import { Request, Response } from "@elements/app";
import { currentUser } from "#app/shared/services/auth";
import { loadDetail, requestChanges, viewable } from "#app/shared/services/requests";
import request from "./template";

export default function route(req: Request, res: Response) {
  let user = currentUser();
  let id = req.params.id;
  let core = viewable(user, id);

  // This request's own changes, plus any change to its department's budget.
  let changes = requestChanges.listen({
    filter: (c) => c.requestId === id || c.departmentId === core.departmentId,
  });

  return new request({
    user,
    changes,
    initial: loadDetail(user, id),
  });
}
