-- demo seed: finance, four departments with heads, eight employees and twenty
-- requests across every status. Every account's password is "spendwick". Vendors are made up.

insert into users (
  email,
  name,
  role,
  passwordHash
) values
  ('fiona@spendwick.example', 'Fiona Reyes', 'finance', crypt('spendwick', genSalt('bf', 10))),
  ('priya@spendwick.example', 'Priya Natarajan', 'head', crypt('spendwick', genSalt('bf', 10))),
  ('diego@spendwick.example', 'Diego Alvarez', 'head', crypt('spendwick', genSalt('bf', 10))),
  ('grace@spendwick.example', 'Grace Kim', 'head', crypt('spendwick', genSalt('bf', 10))),
  ('owen@spendwick.example', 'Owen Price', 'head', crypt('spendwick', genSalt('bf', 10))),
  ('marcus@spendwick.example', 'Marcus Chen', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('lena@spendwick.example', 'Lena Vogel', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('hannah@spendwick.example', 'Hannah Brooks', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('sam@spendwick.example', 'Sam Okafor', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('tom@spendwick.example', 'Tom Becker', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('aisha@spendwick.example', 'Aisha Rahman', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('julia@spendwick.example', 'Julia Moreno', 'employee', crypt('spendwick', genSalt('bf', 10))),
  ('ravi@spendwick.example', 'Ravi Shah', 'employee', crypt('spendwick', genSalt('bf', 10)));

insert into departments (
  name,
  quarterlyBudgetCents,
  headId
) values
  ('Engineering', 2500000, (select id from users where email = 'priya@spendwick.example')),
  ('Marketing', 1500000, (select id from users where email = 'diego@spendwick.example')),
  ('Operations', 800000, (select id from users where email = 'grace@spendwick.example')),
  ('Sales', 900000, (select id from users where email = 'owen@spendwick.example'));

update users
set departmentId = d.id
from departments d
where
  (d.name = 'Engineering' and users.email in ('priya@spendwick.example', 'marcus@spendwick.example', 'lena@spendwick.example'))
  or (d.name = 'Marketing' and users.email in ('diego@spendwick.example', 'hannah@spendwick.example', 'sam@spendwick.example'))
  or (d.name = 'Operations' and users.email in ('grace@spendwick.example', 'tom@spendwick.example', 'aisha@spendwick.example'))
  or (d.name = 'Sales' and users.email in ('owen@spendwick.example', 'julia@spendwick.example', 'ravi@spendwick.example'));

-- Walks one request through the same steps the app takes, so its chain and
-- history agree with its status. frac places it in the current quarter (0 is
-- the first day, 1 is now); a negative frac reaches back into last quarter.
-- stopAt names the step a submitted request waits on, or the step that
-- rejected one.
create function seedRequest(
  requesterEmail text,
  itemText text,
  vendorText text,
  dollars numeric,
  categoryText text,
  reasonText text,
  finalStatus text,
  frac numeric,
  stopAt text default null,
  headNote text default '',
  financeNote text default ''
) returns void
language plpgsql
as $$
declare
  requester users%rowtype;
  dept departments%rowtype;
  financeId uuid;
  reqId uuid;
  cents integer := round(dollars * 100);
  qStart timestamptz := date_trunc('quarter', now());
  t0 timestamptz;
  skipHead boolean;
  needsFinance boolean;
  quote text;
begin
  select * into requester from users where email = requesterEmail;
  select * into dept from departments where id = requester.departmentId;
  select id into financeId from users where role = 'finance' limit 1;

  if frac >= 0 then
    t0 := qStart + (now() - qStart) * frac;
  else
    t0 := qStart + interval '90 days' * frac;
  end if;

  quote := 'QUOTE' || chr(10) || vendorText || chr(10) || chr(10)
    || 'Prepared for: ' || requester.name || ', ' || dept.name || chr(10)
    || 'Item: ' || itemText || chr(10)
    || 'Total: $' || to_char(dollars, 'FM999,999,990.00') || chr(10)
    || 'Valid for 30 days.' || chr(10);

  insert into requests (
    requesterId,
    departmentId,
    item,
    vendor,
    amountCents,
    category,
    reason,
    quoteName,
    quoteContentType,
    quoteSize,
    quoteData,
    createdAt
  ) values (
    requester.id,
    dept.id,
    itemText,
    vendorText,
    cents,
    categoryText,
    reasonText,
    'quote-' || lower(regexp_replace(vendorText, '[^A-Za-z0-9]+', '-', 'g')) || '.txt',
    'text/plain',
    octet_length(quote),
    convert_to(quote, 'UTF8'),
    t0
  )
  returning id into reqId;

  insert into requestEvents (requestId, actorId, action, toStatus, createdAt)
  values (reqId, requester.id, 'created', 'draft', t0);

  if finalStatus = 'draft' then
    return;
  end if;

  update requests
  set
    status = 'submitted',
    submittedAt = t0 + interval '20 minutes'
  where id = reqId;

  insert into requestEvents (requestId, actorId, action, fromStatus, toStatus, createdAt)
  values (reqId, requester.id, 'submitted', 'draft', 'submitted', t0 + interval '20 minutes');

  skipHead := dept.headId = requester.id;
  needsFinance := skipHead or cents > 100000;

  insert into approvals (requestId, step, position, status, approverId, comment)
  values (
    reqId,
    'head',
    1,
    case when skipHead then 'skipped' else 'pending' end,
    dept.headId,
    case when skipHead then 'The requester heads this department, so finance approves instead.' else '' end
  );

  if needsFinance then
    insert into approvals (requestId, step, position, status)
    values (reqId, 'finance', 2, case when skipHead then 'pending' else 'waiting' end);
  end if;

  -- The head decides, unless this one waits on the head or skipped it.
  if not skipHead and not (finalStatus = 'submitted' and stopAt = 'head') then
    if finalStatus = 'rejected' and stopAt = 'head' then
      update approvals
      set
        status = 'rejected',
        comment = headNote,
        decidedAt = least(now(), t0 + interval '3 hours')
      where requestId = reqId and step = 'head';

      update approvals set status = 'skipped' where requestId = reqId and status = 'waiting';
      update requests set status = 'rejected' where id = reqId;

      insert into requestEvents (requestId, actorId, action, step, fromStatus, toStatus, comment, createdAt)
      values (reqId, dept.headId, 'rejected', 'head', 'submitted', 'rejected', headNote, least(now(), t0 + interval '3 hours'));

      return;
    end if;

    update approvals
    set
      status = 'approved',
      comment = headNote,
      decidedAt = least(now(), t0 + interval '3 hours')
    where requestId = reqId and step = 'head';

    if needsFinance then
      update approvals set status = 'pending' where requestId = reqId and step = 'finance';

      insert into requestEvents (requestId, actorId, action, step, comment, createdAt)
      values (reqId, dept.headId, 'approved', 'head', headNote, least(now(), t0 + interval '3 hours'));
    else
      update requests set status = 'approved' where id = reqId;

      insert into requestEvents (requestId, actorId, action, step, fromStatus, toStatus, comment, createdAt)
      values (reqId, dept.headId, 'approved', 'head', 'submitted', 'approved', headNote, least(now(), t0 + interval '3 hours'));
    end if;
  end if;

  if needsFinance and finalStatus <> 'submitted' then
    if finalStatus = 'rejected' then
      update approvals
      set
        status = 'rejected',
        approverId = financeId,
        comment = financeNote,
        decidedAt = least(now(), t0 + interval '6 hours')
      where requestId = reqId and step = 'finance';

      update requests set status = 'rejected' where id = reqId;

      insert into requestEvents (requestId, actorId, action, step, fromStatus, toStatus, comment, createdAt)
      values (reqId, financeId, 'rejected', 'finance', 'submitted', 'rejected', financeNote, least(now(), t0 + interval '6 hours'));

      return;
    end if;

    update approvals
    set
      status = 'approved',
      approverId = financeId,
      comment = financeNote,
      decidedAt = least(now(), t0 + interval '6 hours')
    where requestId = reqId and step = 'finance';

    update requests set status = 'approved' where id = reqId;

    insert into requestEvents (requestId, actorId, action, step, fromStatus, toStatus, comment, createdAt)
    values (reqId, financeId, 'approved', 'finance', 'submitted', 'approved', financeNote, least(now(), t0 + interval '6 hours'));
  end if;

  if finalStatus in ('ordered', 'received') then
    update requests set status = 'ordered' where id = reqId;

    insert into requestEvents (requestId, actorId, action, fromStatus, toStatus, createdAt)
    values (reqId, financeId, 'ordered', 'approved', 'ordered', least(now(), t0 + interval '10 hours'));
  end if;

  if finalStatus = 'received' then
    update requests set status = 'received' where id = reqId;

    insert into requestEvents (requestId, actorId, action, fromStatus, toStatus, createdAt)
    values (reqId, requester.id, 'received', 'ordered', 'received', least(now(), t0 + interval '30 hours'));
  end if;
end;
$$;

select seedRequest('marcus@spendwick.example', 'Cloud architecture certification course', 'Cloudpath Academy', 299, 'Training', 'Prep for the infrastructure migration next quarter.', 'received', -0.5);
select seedRequest('aisha@spendwick.example', 'Label printer and supplies', 'Inkline Supply', 389, 'Office supplies', 'The old printer jams on every shipping label.', 'received', 0.04, null, 'Fine, go ahead.');
select seedRequest('sam@spendwick.example', 'Design tool team plan, annual', 'Palette Studio', 600, 'Software', 'Five seats for the content team, replacing per-person plans.', 'received', 0.06, null, 'Approved. Cancel the individual plans after.');
select seedRequest('marcus@spendwick.example', 'Developer laptop, 16-inch', 'Northbay Computers', 3499, 'Hardware', 'Replacement for a 2019 laptop that can no longer run the build locally.', 'ordered', 0.08, null, 'Yes, overdue.', 'Approved. Ordering through our business account.');
select seedRequest('diego@spendwick.example', 'Paid social campaign, October', 'Brightreach Media', 3000, 'Marketing', 'Paid push for the fall launch, targeting operations leaders.', 'ordered', 0.1, null, '', 'Approved against the Q4 marketing plan.');
select seedRequest('julia@spendwick.example', 'Flights to Chicago customer summit', 'Lakeshore Travel', 1120, 'Travel', 'Two attendees for the Midwest customer summit.', 'ordered', 0.12, null, 'Approved, book economy.', 'Booked.');
select seedRequest('hannah@spendwick.example', 'Trade show booth, Ops Leaders Expo', 'Ops Leaders Expo', 8500, 'Marketing', 'Our biggest lead source last year. Includes a 10x10 booth and two passes.', 'approved', 0.18, null, 'Strongly support this one.', 'Approved. Please send the invoice to AP.');
select seedRequest('lena@spendwick.example', 'USB-C docking stations (x4)', 'Portwell Electronics', 596, 'Hardware', 'For the four new hires starting this month.', 'approved', 0.22, null, 'Approved.');
select seedRequest('tom@spendwick.example', 'Ergonomic chairs (x6)', 'Fernhill Furniture', 5400, 'Furniture', 'Replacing the warehouse office chairs flagged in the safety review.', 'approved', 0.26, null, 'These are long overdue.', 'Approved. Safety review item, so it takes priority.');
select seedRequest('ravi@spendwick.example', 'Client dinner, Acme renewal', 'The Grill Room', 480, 'Travel', 'Dinner with the Acme buying committee ahead of the renewal.', 'approved', 0.3, null, 'Approved. Keep the receipt.');
select seedRequest('owen@spendwick.example', 'CRM data cleanup contractor', 'DataTidy LLC', 2250, 'Professional services', 'Dedupe and enrich 40k CRM records before the territory planning.', 'approved', 0.33, null, '', 'Approved for one engagement. Fixed fee, no overage.');
select seedRequest('tom@spendwick.example', 'Standing desk converters (x3)', 'Upright Office Co.', 735, 'Furniture', 'Requested by three people on the dispatch team.', 'rejected', 0.36, 'head', 'We have four spare converters in storage. Grab those first.');
select seedRequest('hannah@spendwick.example', 'Product launch video production', 'Northlight Studio', 6200, 'Professional services', 'A two-minute launch film with motion graphics.', 'rejected', 0.4, 'finance', 'Good idea, it is a big launch.', 'This would put Marketing over budget this quarter. Re-scope to about $4,000 and resubmit.');
select seedRequest('lena@spendwick.example', 'IDE licenses (5 seats)', 'Kodex Tools', 1245, 'Software', 'Annual renewal for the backend team.', 'submitted', 0.5, 'finance', 'Approved, we use these every day.');
select seedRequest('priya@spendwick.example', 'Engineering offsite venue deposit', 'Pinecrest Lodge', 4800, 'Travel', 'Deposit for the two-day planning offsite in November, 14 people.', 'submitted', 0.58, 'finance');
select seedRequest('julia@spendwick.example', 'Call recording seats (4)', 'Callwise', 5760, 'Software', 'Call recording for the four new account executives.', 'submitted', 0.66, 'finance', 'Approved. The new AEs need this to ramp.');
select seedRequest('marcus@spendwick.example', 'Tracing add-on, Q4', 'Tracelight', 2400, 'Software', 'Tracing for the checkout service before the holiday traffic.', 'submitted', 0.74, 'head');
select seedRequest('sam@spendwick.example', 'Branded hoodies for the conference', 'Stitchyard', 940, 'Marketing', 'Fifty hoodies for the booth team and giveaways.', 'submitted', 0.82, 'head');
select seedRequest('aisha@spendwick.example', 'First aid kits and safety signage', 'Harbor Safety Supply', 212, 'Office supplies', 'Restock after the safety audit.', 'draft', 0.88);
select seedRequest('ravi@spendwick.example', 'Negotiation workshop', 'Closewell Training', 1800, 'Training', 'Two-day workshop for the sales team.', 'draft', 0.94);

drop function seedRequest(text, text, text, numeric, text, text, text, numeric, text, text, text);
