create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  username text not null default '',
  age integer check (age is null or age between 10 and 25),
  gender text not null default '',
  grade integer check (grade is null or grade between 6 and 12),
  interests text[] not null default '{}',
  location text not null default '',
  goals text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  organization text not null default '',
  category text not null default 'Activity',
  location text not null default '',
  subject_area text not null default '',
  deadline text,
  deadline_date date,
  is_active boolean not null default true,
  timeline text not null default '',
  grade_level text not null default 'High School',
  description text not null default '',
  link text not null unique,
  source text not null default '',
  source_url text not null default '',
  scraped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.saved_opportunities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  opportunity_link text not null,
  opportunity_data jsonb not null,
  status text not null default 'Interested',
  custom_deadline_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opportunity_link)
);

create table if not exists public.push_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
add column if not exists updated_at timestamptz not null default now();

alter table public.opportunities
add column if not exists updated_at timestamptz not null default now();

alter table public.saved_opportunities
add column if not exists updated_at timestamptz not null default now();

alter table public.saved_opportunities
add column if not exists custom_deadline_date date;

alter table public.push_subscriptions
add column if not exists updated_at timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists set_opportunities_updated_at on public.opportunities;
create trigger set_opportunities_updated_at
before update on public.opportunities
for each row execute function public.set_updated_at();

drop trigger if exists set_saved_opportunities_updated_at on public.saved_opportunities;
create trigger set_saved_opportunities_updated_at
before update on public.saved_opportunities
for each row execute function public.set_updated_at();

drop trigger if exists set_push_subscriptions_updated_at on public.push_subscriptions;
create trigger set_push_subscriptions_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

create or replace function public.set_opportunity_active_status()
returns trigger
language plpgsql
as $$
begin
  new.is_active = coalesce(new.deadline_date >= current_date, true);
  return new;
end;
$$;

drop trigger if exists set_opportunity_active_status on public.opportunities;
create trigger set_opportunity_active_status
before insert or update of deadline_date, is_active on public.opportunities
for each row execute function public.set_opportunity_active_status();

create or replace function public.archive_expired_opportunities()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  archived_count integer;
begin
  update public.opportunities
  set is_active = false,
      updated_at = now()
  where deadline_date is not null
    and deadline_date < current_date
    and is_active = true;

  get diagnostics archived_count = row_count;
  return archived_count;
end;
$$;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    username,
    age,
    gender,
    grade,
    interests,
    location,
    goals
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'username', ''),
    case
      when coalesce(new.raw_user_meta_data->>'age', '') ~ '^\d+$'
        then (new.raw_user_meta_data->>'age')::integer
      else null
    end,
    coalesce(new.raw_user_meta_data->>'gender', ''),
    case
      when coalesce(new.raw_user_meta_data->>'grade', '') ~ '^\d+$'
        then (new.raw_user_meta_data->>'grade')::integer
      else null
    end,
    coalesce(
      array(select jsonb_array_elements_text(coalesce(new.raw_user_meta_data->'interests', '[]'::jsonb))),
      '{}'
    ),
    coalesce(new.raw_user_meta_data->>'location', ''),
    coalesce(new.raw_user_meta_data->>'goals', '')
  )
  on conflict (id) do update
  set
    email = excluded.email,
    username = excluded.username,
    age = excluded.age,
    gender = excluded.gender,
    grade = excluded.grade,
    interests = excluded.interests,
    location = excluded.location,
    goals = excluded.goals;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
after insert on auth.users
for each row execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;
alter table public.opportunities enable row level security;
alter table public.saved_opportunities enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles for select
using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "Anyone can read active opportunities" on public.opportunities;
create policy "Anyone can read active opportunities"
on public.opportunities for select
using (is_active = true);

drop policy if exists "Users can read own saved opportunities" on public.saved_opportunities;
create policy "Users can read own saved opportunities"
on public.saved_opportunities for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own saved opportunities" on public.saved_opportunities;
create policy "Users can insert own saved opportunities"
on public.saved_opportunities for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own saved opportunities" on public.saved_opportunities;
create policy "Users can update own saved opportunities"
on public.saved_opportunities for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own saved opportunities" on public.saved_opportunities;
create policy "Users can delete own saved opportunities"
on public.saved_opportunities for delete
using (auth.uid() = user_id);

drop policy if exists "Users can read own push subscriptions" on public.push_subscriptions;
create policy "Users can read own push subscriptions"
on public.push_subscriptions for select
using (auth.uid() = user_id);

drop policy if exists "Users can upsert own push subscriptions" on public.push_subscriptions;
create policy "Users can upsert own push subscriptions"
on public.push_subscriptions for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own push subscriptions" on public.push_subscriptions;
create policy "Users can update own push subscriptions"
on public.push_subscriptions for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Users can delete own push subscriptions" on public.push_subscriptions;
create policy "Users can delete own push subscriptions"
on public.push_subscriptions for delete
using (auth.uid() = user_id);

create index if not exists opportunities_active_deadline_idx
on public.opportunities (is_active, deadline_date);

create index if not exists opportunities_category_idx
on public.opportunities (category);
