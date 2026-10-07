-- purchase approvals

-- Auto-update updatedAt on row changes.
create or replace function touchUpdatedAt()
returns trigger
language plpgsql
as $$
begin
  new.updatedAt = now();
  return new;
end;
$$;

create table departments (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  name text not null unique,
  quarterlyBudgetCents integer not null default 0 check (quarterlyBudgetCents >= 0),
  headId uuid
);

create trigger departmentsTouchUpdatedAt
  before update on departments
  for each row execute function touchUpdatedAt();

create table users (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  email text not null unique,
  name text not null,
  passwordHash text not null,
  role text not null default 'employee' check (role in ('employee', 'head', 'finance')),
  departmentId uuid references departments(id) on delete set null
);

create trigger usersTouchUpdatedAt
  before update on users
  for each row execute function touchUpdatedAt();

alter table departments
  add constraint departmentsHeadIdFkey foreign key (headId) references users(id) on delete set null;

create table requests (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  number serial not null unique,
  requesterId uuid not null references users(id),
  departmentId uuid not null references departments(id),
  item text not null,
  vendor text not null,
  amountCents integer not null check (amountCents > 0),
  category text not null,
  reason text not null default '',
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'rejected', 'ordered', 'received')),
  quoteName text,
  quoteContentType text,
  quoteSize integer,
  quoteData bytea,
  submittedAt timestamptz
);

alter sequence requests_number_seq restart with 1001;

create index requestsDepartmentIdx on requests (departmentId, status);
create index requestsRequesterIdx on requests (requesterId);

create trigger requestsTouchUpdatedAt
  before update on requests
  for each row execute function touchUpdatedAt();

create table approvals (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  requestId uuid not null references requests(id) on delete cascade,
  step text not null check (step in ('head', 'finance')),
  position integer not null,
  status text not null default 'waiting' check (status in ('waiting', 'pending', 'approved', 'rejected', 'skipped')),
  approverId uuid references users(id),
  comment text not null default '',
  decidedAt timestamptz,
  unique (requestId, step)
);

create index approvalsPendingIdx on approvals (status, step);

create trigger approvalsTouchUpdatedAt
  before update on approvals
  for each row execute function touchUpdatedAt();

create table requestEvents (
  id uuid primary key default uuidGenerateV7(),
  createdAt timestamptz not null default now(),
  updatedAt timestamptz not null default now(),
  requestId uuid not null references requests(id) on delete cascade,
  actorId uuid references users(id),
  action text not null check (action in ('created', 'edited', 'submitted', 'approved', 'rejected', 'ordered', 'received', 'commented')),
  step text check (step in ('head', 'finance')),
  fromStatus text,
  toStatus text,
  comment text not null default ''
);

create index requestEventsRequestIdx on requestEvents (requestId, createdAt);

create trigger requestEventsTouchUpdatedAt
  before update on requestEvents
  for each row execute function touchUpdatedAt();
