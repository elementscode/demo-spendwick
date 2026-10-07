import { Request, Response, redirect, session, sql } from "@elements/app";
import signin, { DemoAccount } from "./template";

export default function route(req: Request, res: Response) {
  if (session.isLoggedIn()) {
    redirect("/requests");
    return;
  }

  // The seeded accounts, so a visitor can sign in without signing up.
  let accounts = sql<DemoAccount>(`
    select
      u.email,
      u.name,
      u.role,
      d.name as departmentName
    from users u
    left join departments d on d.id = u.departmentId
    where u.email like '%@spendwick.example'
    order by
      case u.role when 'finance' then 0 when 'head' then 1 else 2 end,
      d.name,
      u.name
  `).all();

  return new signin({ accounts });
}
