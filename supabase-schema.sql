create table if not exists public.user_planner_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  tasks jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '[]'::jsonb,
  brain_dump text not null default '',
  focus_minutes integer not null default 0 check (focus_minutes >= 0),
  completed_sessions integer not null default 0 check (completed_sessions >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_planner_data enable row level security;

drop policy if exists "Users can read their own planner data" on public.user_planner_data;
create policy "Users can read their own planner data"
  on public.user_planner_data for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own planner data" on public.user_planner_data;
create policy "Users can insert their own planner data"
  on public.user_planner_data for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own planner data" on public.user_planner_data;
create policy "Users can update their own planner data"
  on public.user_planner_data for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_planner_data to authenticated;

create table if not exists public.user_planner_days (
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_date date not null,
  tasks jsonb not null default '[]'::jsonb,
  schedule jsonb not null default '[]'::jsonb,
  brain_dump text not null default '',
  focus_minutes integer not null default 0 check (focus_minutes >= 0),
  completed_sessions integer not null default 0 check (completed_sessions >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_date)
);

alter table public.user_planner_days enable row level security;

drop policy if exists "Users can read their own planner days" on public.user_planner_days;
create policy "Users can read their own planner days"
  on public.user_planner_days for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their own planner days" on public.user_planner_days;
create policy "Users can insert their own planner days"
  on public.user_planner_days for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own planner days" on public.user_planner_days;
create policy "Users can update their own planner days"
  on public.user_planner_days for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update on public.user_planner_days to authenticated;

insert into public.user_planner_days
  (user_id, plan_date, tasks, schedule, brain_dump, focus_minutes, completed_sessions, updated_at)
select
  user_id, current_date, tasks, schedule, brain_dump, focus_minutes, completed_sessions, updated_at
from public.user_planner_data
on conflict (user_id, plan_date) do nothing;
