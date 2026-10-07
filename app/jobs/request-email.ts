import { Job, email, sql } from "@elements/app";
import { Step, requestNumber } from "#app/shared/models";
import NeedsApprovalEmail, { EmailRequest } from "#app/emails/needs-approval";
import DecisionEmail from "#app/emails/decision";

export interface RequestEmailJobFields {
  kind: "needs-approval" | "decision";
  requestId: string;
  step: Step;
  decision?: "approved" | "rejected";
  approverName?: string;
  comment?: string;
  final?: boolean;
}

/**
 * Emails the next approver when a request reaches their step, and the
 * requester after each decision. Scheduled inside the transaction that made
 * the change, so nothing is sent for a write that rolled back.
 */
export class RequestEmailJob extends Job<RequestEmailJobFields> {
  static maxAttempts = 5;

  run() {
    let f = this.fields;
    let request = sql<EmailRequest & { departmentId: string }>(`
      select
        r.id,
        r.number,
        r.item,
        r.vendor,
        r.amountCents,
        r.category,
        r.reason,
        r.departmentId,
        d.name as departmentName,
        u.name as requesterName,
        u.email as requesterEmail
      from requests r
      join departments d on d.id = r.departmentId
      join users u on u.id = r.requesterId
      where r.id = ${f.requestId}
    `).first();

    if (!request) {
      return;
    }

    if (f.kind === "needs-approval") {
      let to = approverEmails(f.step, request.departmentId);
      if (to.length === 0) {
        return;
      }

      email({
        to,
        subject: `${requestNumber(request.number)} needs your approval: ${request.item}`,
        body: new NeedsApprovalEmail({
          request,
          step: f.step,
        }),
      });

      return;
    }

    let decision = f.decision ?? "approved";
    let verb = decision === "rejected" ? "rejected" : f.final ? "approved" : "approved by your department head";

    email({
      to: request.requesterEmail,
      subject: `${requestNumber(request.number)} ${verb}: ${request.item}`,
      body: new DecisionEmail({
        request,
        step: f.step,
        decision,
        approverName: f.approverName ?? "An approver",
        comment: f.comment ?? "",
        final: f.final ?? true,
      }),
    });
  }
}

export function approverEmails(step: Step, departmentId: string): string[] {
  if (step === "finance") {
    return sql<{ email: string }>(`
      select email
      from users
      where role = 'finance'
      order by email
    `).all().map((u) => u.email);
  }

  return sql<{ email: string }>(`
    select u.email
    from departments d
    join users u on u.id = d.headId
    where d.id = ${departmentId}
  `).all().map((u) => u.email);
}
