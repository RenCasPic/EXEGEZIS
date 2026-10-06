-- The app talks to the database through Supabase's Data API, like any
-- Supabase app (docs/13-accounts.md): with each user's session for their own
-- data (Row Level Security applies), and with the service role key only for
-- the operator's tasks (rate limits, the CLI's claim-local, setting a plan).
-- Safe to apply again.

-- Projects created without «Automatically expose new tables» grant nothing by
-- default: the service role gets what the operator's tasks need.
grant usage on schema public to service_role;
grant select, insert, update, delete on public.profiles, public.consents, public.projects, public.runs, public.waitlist, public.rate_limits to service_role;

-- Counts one attempt for a key (sign-in, sign-up, password recovery) in one
-- atomic statement; says whether it is allowed and, if not, for how long.
create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  h integer;
  ws timestamptz;
begin
  insert into public.rate_limits as r (key, window_start, hits) values (left(p_key, 300), now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning r.hits, r.window_start into h, ws;
  allowed := h <= p_limit;
  retry_after_seconds := case when h <= p_limit then 0 else greatest(0, ceil(p_window_seconds - extract(epoch from (now() - ws))))::integer end;
  return next;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;
