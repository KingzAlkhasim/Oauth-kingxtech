-- Records which version of the Terms each person accepted.
-- People who signed up with the checkbox already carry the version in their profile;
-- this table covers existing users and Google/GitHub sign-ups.
create table if not exists public.terms_acceptances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now()
);
alter table public.terms_acceptances enable row level security;

drop policy if exists "Read own terms acceptance" on public.terms_acceptances;
create policy "Read own terms acceptance" on public.terms_acceptances
  for select using (auth.uid() = user_id);
-- No insert/update policy: acceptance is written only through accept_terms().

create or replace function public.accept_terms(p_version text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_version is null or length(trim(p_version)) = 0 or length(p_version) > 40 then
    raise exception 'Invalid version';
  end if;
  insert into public.terms_acceptances (user_id, version, accepted_at)
  values (auth.uid(), trim(p_version), now())
  on conflict (user_id) do update set version = excluded.version, accepted_at = now();
end;
$$;
revoke all on function public.accept_terms(text) from public;
grant execute on function public.accept_terms(text) to authenticated;
