import { Request, Response } from "@elements/app";
import { currentUser } from "#app/shared/services/auth";
import { loadRequestsPage, requestChanges } from "#app/shared/services/requests";
import requests from "./template";

export default function route(req: Request, res: Response) {
  let user = currentUser();

  // Listen before reading, so a change that lands in between is not missed.
  let changes = requestChanges.listen({
    filter: (c) => user.role === "finance" || c.requesterId === user.id || c.departmentId === user.headOfId || c.departmentId === user.departmentId,
  });

  return new requests({
    user,
    changes,
    initial: loadRequestsPage(user),
  });
}
