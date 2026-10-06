-- Protection against abuse (docs/13-accounts.md): site ownership and the AI
-- spent today. Safe to apply again.

-- Sites a user has proved are theirs (a meta tag on the home page or a DNS TXT
-- record, as with Google Search Console). Needed for inspections and searches
-- of more than 20 pages. The user adds a site and its token; only the server
-- (service role) marks it verified, after checking the site.
create table if not exists public.site_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  site text not null check (char_length(site) between 1 and 255),
  token text not null check (char_length(token) between 16 and 64),
  method text check (method in ('meta', 'dns')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, site)
);

alter table public.site_verifications enable row level security;
revoke all on public.site_verifications from anon, authenticated;
grant select, delete on public.site_verifications to authenticated;
grant insert (user_id, site, token) on public.site_verifications to authenticated;
grant select, insert, update, delete on public.site_verifications to service_role;

drop policy if exists "site_verifications: read own" on public.site_verifications;
create policy "site_verifications: read own" on public.site_verifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "site_verifications: insert own" on public.site_verifications;
create policy "site_verifications: insert own" on public.site_verifications for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "site_verifications: delete own" on public.site_verifications;
create policy "site_verifications: delete own" on public.site_verifications for delete to authenticated using (user_id = (select auth.uid()));

-- What every user together has spent on AI since a moment (the daily global cap).
create or replace function public.ai_spent_since(p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(ai_usd), 0) from public.runs where created_at >= p_since;
$$;

revoke all on function public.ai_spent_since(timestamptz) from public, anon, authenticated;
grant execute on function public.ai_spent_since(timestamptz) to service_role;
