create table if not exists public.counters (
  key text primary key,
  value bigint not null default 0
);

create table if not exists public.logs (
  id bigserial primary key,
  type text not null check (type in ('visit', 'play')),
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create table if not exists public.daily_stats (
  day date primary key,
  visits bigint not null default 0,
  plays bigint not null default 0
);

create table if not exists public.sessions (
  id text primary key,
  visit_counted boolean not null default false,
  play_counted boolean not null default false,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

insert into public.counters (key, value)
values ('visits', 0), ('plays', 0)
on conflict (key) do nothing;

create or replace function public.increment_metric(
  metric_key text,
  daily_key text,
  stat_day date,
  log_type text,
  log_meta jsonb
) returns void
language plpgsql
security definer
as $$
begin
  if metric_key not in ('visits', 'plays') then
    raise exception 'Invalid metric key: %', metric_key;
  end if;

  if daily_key not in ('visits', 'plays') then
    raise exception 'Invalid daily key: %', daily_key;
  end if;

  insert into public.counters (key, value)
  values (metric_key, 1)
  on conflict (key) do update set value = public.counters.value + 1;

  insert into public.daily_stats (day, visits, plays)
  values (
    stat_day,
    case when daily_key = 'visits' then 1 else 0 end,
    case when daily_key = 'plays' then 1 else 0 end
  )
  on conflict (day) do update set
    visits = public.daily_stats.visits + case when daily_key = 'visits' then 1 else 0 end,
    plays = public.daily_stats.plays + case when daily_key = 'plays' then 1 else 0 end;

  insert into public.logs (type, meta)
  values (log_type, coalesce(log_meta, '{}'::jsonb));
end;
$$;

create or replace function public.reset_metrics()
returns void
language plpgsql
security definer
as $$
begin
  update public.counters set value = 0;
  delete from public.logs;
  delete from public.daily_stats;
  update public.sessions set visit_counted = false, play_counted = false;
end;
$$;
