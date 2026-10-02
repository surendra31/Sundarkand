-- Sundarkand Scheduling — Supabase schema
-- Run this once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Safe to re-run: it drops and recreates the functions and policies (not the data).

-- ───────────────────────── Tables ─────────────────────────

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  created_at  timestamptz not null default now()
);

create table if not exists public.events (
  id             uuid primary key default gen_random_uuid(),
  host_id        uuid not null references auth.users (id) on delete cascade,
  title          text not null check (char_length(title) between 1 and 120),
  location       text not null default '' check (char_length(location) <= 200),
  notes          text not null default '' check (char_length(notes) <= 1000),
  final_slot_id  uuid,
  created_at     timestamptz not null default now()
);

create table if not exists public.slots (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  starts_at   timestamptz not null,
  note        text not null default '' check (char_length(note) <= 120),
  position    smallint not null
);
create index if not exists slots_event_idx on public.slots (event_id, position);

create table if not exists public.responses (
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  choices     uuid[] not null default '{}',
  declined    boolean not null default false,
  comment     text not null default '' check (char_length(comment) <= 300),
  updated_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

-- ───────────────────────── Row-level security ─────────────────────────
-- Any signed-in user can read events, slots, responses and names (they need the
-- event link to find one). All writes go through the functions below, which
-- check who is calling. Email addresses are never exposed.

alter table public.profiles  enable row level security;
alter table public.events    enable row level security;
alter table public.slots     enable row level security;
alter table public.responses enable row level security;

drop policy if exists "read profiles"  on public.profiles;
drop policy if exists "read events"    on public.events;
drop policy if exists "read slots"     on public.slots;
drop policy if exists "read responses" on public.responses;

create policy "read profiles"  on public.profiles  for select to authenticated using (true);
create policy "read events"    on public.events    for select to authenticated using (true);
create policy "read slots"     on public.slots     for select to authenticated using (true);
create policy "read responses" on public.responses for select to authenticated using (true);

-- ───────────────────────── Functions ─────────────────────────

-- Registration: save or update the caller's display name.
create or replace function public.save_profile(p_name text)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_row  public.profiles;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if char_length(v_name) not between 1 and 80 then raise exception 'Please enter your name.'; end if;
  insert into public.profiles (id, name) values (auth.uid(), v_name)
  on conflict (id) do update set name = excluded.name
  returning * into v_row;
  return v_row;
end $$;

-- Host creates an event with 2–5 proposed slots: [{ "starts_at": "...", "note": "..." }, ...]
create or replace function public.create_event(p_title text, p_location text, p_notes text, p_slots jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid;
  v_count int := coalesce(jsonb_array_length(p_slots), 0);
  v_slot  jsonb;
  v_pos   int := 0;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Please finish registration first.';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then raise exception 'Please give the event a title.'; end if;
  if v_count < 2 or v_count > 5 then raise exception 'Please propose between 2 and 5 time slots.'; end if;

  insert into public.events (host_id, title, location, notes)
  values (auth.uid(), btrim(p_title), btrim(coalesce(p_location, '')), btrim(coalesce(p_notes, '')))
  returning id into v_id;

  for v_slot in select * from jsonb_array_elements(p_slots) loop
    insert into public.slots (event_id, starts_at, note, position)
    values (v_id, (v_slot->>'starts_at')::timestamptz, btrim(coalesce(v_slot->>'note', '')), v_pos);
    v_pos := v_pos + 1;
  end loop;

  return v_id;
end $$;

-- Participant votes for one or more slots, or declines. Calling again updates the answer.
create or replace function public.submit_response(p_event_id uuid, p_choices uuid[], p_declined boolean, p_comment text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event   public.events;
  v_choices uuid[];
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Please finish registration first.';
  end if;
  select * into v_event from public.events where id = p_event_id;
  if not found then raise exception 'Event not found.'; end if;
  if v_event.final_slot_id is not null then raise exception 'The host has already confirmed a time.'; end if;

  -- keep only real slot ids from this event
  select coalesce(array_agg(distinct s.id), '{}') into v_choices
  from public.slots s
  where s.event_id = p_event_id and s.id = any (coalesce(p_choices, '{}'));

  if coalesce(p_declined, false) then
    v_choices := '{}';
  elsif cardinality(v_choices) = 0 then
    raise exception 'Pick at least one slot, or choose "I can''t make any".';
  end if;

  insert into public.responses (event_id, user_id, choices, declined, comment, updated_at)
  values (p_event_id, auth.uid(), v_choices, coalesce(p_declined, false), left(btrim(coalesce(p_comment, '')), 300), now())
  on conflict (event_id, user_id) do update
    set choices = excluded.choices, declined = excluded.declined,
        comment = excluded.comment, updated_at = now();
end $$;

-- Host confirms the final slot (pass null to reopen voting).
create or replace function public.finalize_event(p_event_id uuid, p_slot_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  if not exists (select 1 from public.events where id = p_event_id and host_id = auth.uid()) then
    raise exception 'Only the host can confirm a time.';
  end if;
  if p_slot_id is not null and not exists (select 1 from public.slots where id = p_slot_id and event_id = p_event_id) then
    raise exception 'Unknown slot.';
  end if;
  update public.events set final_slot_id = p_slot_id where id = p_event_id;
end $$;

-- Only signed-in users may call these.
revoke all on function public.save_profile(text)                         from public, anon;
revoke all on function public.create_event(text, text, text, jsonb)      from public, anon;
revoke all on function public.submit_response(uuid, uuid[], boolean, text) from public, anon;
revoke all on function public.finalize_event(uuid, uuid)                 from public, anon;
grant execute on function public.save_profile(text)                         to authenticated;
grant execute on function public.create_event(text, text, text, jsonb)      to authenticated;
grant execute on function public.submit_response(uuid, uuid[], boolean, text) to authenticated;
grant execute on function public.finalize_event(uuid, uuid)                 to authenticated;
