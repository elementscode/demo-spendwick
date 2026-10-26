![Purchase requests with budget approvals, built by Claude Code on Elements: a submitted request with its details, history, an approval chain waiting on finance, and a Sales budget panel warning that approval would go $610 over the quarter.](https://elements.dev/demos/01a113f7-bd6b-7e16-aa64-f1a0e4a2e7b9/poster?v=584ef3e9d46c)

# Purchase requests with budget approvals, built by Claude Code on Elements

> Spendwick is a full-stack app built with Claude Code on Elements.

Purchase requests with attached quotes, department head and finance approvals, live quarterly budgets that warn before overspending, decision emails and a finance spend view.

[Run this app on your machine](https://elements.dev/demos/01a113f7-bd6b-7e16-aa64-f1a0e4a2e7b9). Use this demo as inspiration, or as the starting point for your own app. Your agent creates a new app with this one as the scaffold, and you prompt it to add whatever features you want.

## How it's built

Spendwick needed three kinds of accounts, an approval chain that routes each request by department and amount, quarterly budgets and statuses that update on every open screen, emails on each step, and a CSV export for finance. Each of those is a part of Elements, so the agent spent its 19 minutes on the approvals app itself.

- **Live statuses and budgets.** Every change to a request notifies a channel. Each open page listens and re-reads its own slice through an `@rpc`, so an approval shows up at once on the requester's list, the head's budget and the finance totals.

- **Approvals in one transaction.** Approving or rejecting records the decision and comment, moves the request to its next step, adds the history entry and schedules the emails in one transaction, so the chain, the history and the status always agree.

- **Emails as background jobs.** A job sends the next approver a "needs your approval" email and the requester an email on each decision, from two email templates. It is scheduled inside the change's transaction, so it runs once the change commits.

- **Attached quotes.** The request form sends the quote to an `@rpc` as a `File`, which checks its type and size and stores it with the request, and a route serves it back to the people who can see that request.

- **Sessions and roles.** One guard reads the signed-in user's role and department, so employees see their own requests, heads see their department's, and only finance reaches the finance view, the departments page and the CSV export route.

- **Data from SQL files.** Migrations define the schema and seed finance, four departments with heads and budgets, eight employees and twenty requests walked through the app's own steps. The project server applied each one as soon as it was saved.

## Why Elements

Elements is an integrated full-stack app framework and a project server. The project server checks the agent's work as it builds: it type-checks the server and browser code, analyzes the program, applies migrations and runs the tests, then reports the results to the agent. A security mistake, such as calling a server-only function from the browser, is a compile error. The agent reads the report and fixes its own mistakes before it tells you a feature is done. The same checks run on every feature you ask for next.
