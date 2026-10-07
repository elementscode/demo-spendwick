![Spendwick, a purchase approvals app built with Elements: a submitted request with its details, history, an approval chain waiting on finance, and a Sales budget panel warning that approval would go $610 over the quarter.](https://elements.dev/demos/01a113f7-bd6b-7e16-aa64-f1a0e4a2e7b9/poster?v=584ef3e9d46c)

# Spendwick

> A demo app built with [Elements](https://elements.dev).

Purchase requests with attached quotes, department head and finance approvals, live quarterly budgets that warn before overspending, decision emails and a finance spend view.

**Demo:** [Spendwick](https://elements.dev/demos/01a113f7-bd6b-7e16-aa64-f1a0e4a2e7b9)

## Agent specs

- **Agent:** Claude Code, Opus 5.5 Medium
- **Time:** 19 min
- **Cost:** $8.22 at API rates, October 2026

## Get started

```bash
elements create spendwick -scaffold=elementscode/demo-spendwick
```

## How it's built

Spendwick needed three kinds of accounts, an approval chain that routes each request by department and amount, quarterly budgets and statuses that update on every open screen, emails on each step, and a CSV export for finance. Each of those is a part of Elements, so the agent spent its 19 minutes on the approvals app itself.

### What Elements gave the app

- **Live statuses and budgets.** Every change to a request notifies a channel. Each open page listens and re-reads its own slice through an `@rpc`, so an approval shows up at once on the requester's list, the head's budget and the finance totals.

- **Approvals in one transaction.** Approving or rejecting records the decision and comment, moves the request to its next step, adds the history entry and schedules the emails in one transaction, so the chain, the history and the status always agree.

- **Emails as background jobs.** A job sends the next approver a "needs your approval" email and the requester an email on each decision, from two email templates. It is scheduled inside the change's transaction, so it runs once the change commits.

- **Attached quotes.** The request form sends the quote to an `@rpc` as a `File`, which checks its type and size and stores it with the request, and a route serves it back to the people who can see that request.

- **Sessions and roles.** One guard reads the signed-in user's role and department, so employees see their own requests, heads see their department's, and only finance reaches the finance view, the departments page and the CSV export route.

- **Data from SQL files.** Migrations define the schema and seed finance, four departments with heads and budgets, eight employees and twenty requests walked through the app's own steps. The project server applied each one as soon as it was saved.

### What the project server gave the agent

The project server runs alongside the agent and answers as soon as a file is saved: it type-checks the templates, TypeScript and SQL, applies migrations and reruns the tests, so every question came back right away and the agent kept building.

### What shipped

The app type-checks with zero errors and all 14 tests pass. Every page works on desktop and phone, and live updates arrive across tabs, such as an approval moving a request to finance and updating the finance totals on another open screen.

## Demo accounts

The seed creates one finance account, four departments (Engineering,
Marketing, Operations and Sales) each with a head and a quarterly budget,
eight employees, and twenty purchase requests across every status, each with
its approval chain, history and an attached quote. Sales has enough pending to
show the over-budget warning. Every account's password is `spendwick`, and the
sign-in page lists them in development.

| Email                     | Role            | Department  |
| ------------------------- | --------------- | ----------- |
| fiona@spendwick.example   | finance         |             |
| priya@spendwick.example   | department head | Engineering |
| diego@spendwick.example   | department head | Marketing   |
| grace@spendwick.example   | department head | Operations  |
| owen@spendwick.example    | department head | Sales       |
| marcus@spendwick.example  | employee        | Engineering |
| lena@spendwick.example    | employee        | Engineering |
| hannah@spendwick.example  | employee        | Marketing   |
| sam@spendwick.example     | employee        | Marketing   |
| tom@spendwick.example     | employee        | Operations  |
| aisha@spendwick.example   | employee        | Operations  |
| julia@spendwick.example   | employee        | Sales       |
| ravi@spendwick.example    | employee        | Sales       |

Every request needs its department head; requests over $1,000 also need
finance. Finance manages departments, heads and budgets on the Departments
page, and exports requests as CSV from the Finance page. In development the
approval and decision emails are written to `.elements/logs/job.log` instead
of sent; set the SMTP values in `config/env/production.env` to send them for
real.

**Demo:** [Spendwick](https://elements.dev/demos/01a113f7-bd6b-7e16-aa64-f1a0e4a2e7b9)

## License

MIT. See [LICENSE](LICENSE).
