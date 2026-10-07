import { sql, session, AuthError, ForbiddenError } from "@elements/app";
import { CurrentUser } from "#app/shared/models";

export function loadUser(userId: string): CurrentUser | undefined {
  return sql<CurrentUser>(`
    select
      u.id,
      u.name,
      u.email,
      u.role,
      u.departmentId,
      d.name as departmentName,
      (select h.id from departments h where h.headId = u.id limit 1) as headOfId
    from users u
    left join departments d on d.id = u.departmentId
    where u.id = ${userId}
  `).first();
}

// Roles and headships change while people are signed in, so every check reads
// the row rather than trusting what the session held at signin.
export function currentUser(): CurrentUser {
  session.isLoggedInOrThrow();

  let user = loadUser(session.getOrThrow("userId"));
  if (!user) {
    session.logout();
    throw new AuthError("sign in again");
  }

  return user;
}

export function currentUserOrNull(): CurrentUser | null {
  if (!session.isLoggedIn()) {
    return null;
  }

  return loadUser(session.getOrThrow("userId")) ?? null;
}

export function requireFinance(): CurrentUser {
  let user = currentUser();
  if (user.role !== "finance") {
    throw new ForbiddenError("finance access required");
  }

  return user;
}

/** @rpc */
export function signin(email: string, password: string) {
  let address = email.trim().toLowerCase();

  if (!address || !password) {
    throw new AuthError("enter your email and password");
  }

  let user = sql<{ id: string; name: string }>(`
    select
      id,
      name
    from users
    where
      email = ${address}
      and passwordHash = crypt(${password}, passwordHash)
  `).firstOrThrow(new AuthError("invalid email or password"));

  session.login({
    userId: user.id,
    userName: user.name,
  });
}

/** @rpc */
export function signout() {
  session.logout();
}
