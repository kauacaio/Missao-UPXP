-- CRM privado da Missão UPXP
-- Execute no SQL Editor do Supabase antes de publicar o novo formulário.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'players_name_check' and conrelid = 'public.players'::regclass) then
    alter table public.players add constraint players_name_check check (char_length(name) between 2 and 60);
  end if;
end;
$$;

create table if not exists public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete set null,
  name text not null check (char_length(name) between 2 and 60),
  phone text not null unique check (phone ~ '^[0-9]{10,11}$'),
  marketing_consent boolean not null default false,
  privacy_accepted_at timestamptz not null default now(),
  marketing_consented_at timestamptz,
  source text not null default 'missao-upxp-2026',
  status text not null default 'novo' check (status in ('novo','contatado','convertido','descartado')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.campaign_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.campaign_leads enable row level security;
alter table public.campaign_admins enable row level security;

create or replace function public.is_campaign_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.campaign_admins where user_id = auth.uid());
$$;

revoke all on public.campaign_leads from anon;
revoke all on public.campaign_leads from authenticated;
grant select, update, delete on public.campaign_leads to authenticated;
grant execute on function public.is_campaign_admin() to authenticated;

drop policy if exists "admins read leads" on public.campaign_leads;
create policy "admins read leads" on public.campaign_leads
  for select to authenticated using (public.is_campaign_admin());
drop policy if exists "admins update leads" on public.campaign_leads;
create policy "admins update leads" on public.campaign_leads
  for update to authenticated using (public.is_campaign_admin()) with check (public.is_campaign_admin());
drop policy if exists "admins delete leads" on public.campaign_leads;
create policy "admins delete leads" on public.campaign_leads
  for delete to authenticated using (public.is_campaign_admin());

drop policy if exists "admin sees own access" on public.campaign_admins;
create policy "admin sees own access" on public.campaign_admins
  for select to authenticated using (user_id = auth.uid());

create or replace function public.register_player(
  participant_name text,
  participant_phone text,
  accepts_marketing boolean default false
)
returns table(id uuid, name text, school text, class_name text, score integer, completed_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_name text := trim(participant_name);
  clean_phone text := regexp_replace(participant_phone, '[^0-9]', '', 'g');
  v_player_id uuid;
begin
  if char_length(clean_name) not between 2 and 60 then raise exception 'Nome inválido'; end if;
  if clean_phone !~ '^[0-9]{10,11}$' then raise exception 'Telefone inválido'; end if;

  select p.id into v_player_id
  from public.players p
  join public.campaign_leads cl on cl.player_id = p.id
  where cl.phone = clean_phone
  order by p.score desc, p.completed_count desc, p.created_at asc
  limit 1;

  if v_player_id is null then
    insert into public.players(name, school, class_name)
    values(clean_name, 'Não informado', 'Não informado')
    returning id into v_player_id;
  else
    update public.players set name = clean_name where id = v_player_id;
  end if;

  insert into public.campaign_leads(player_id, name, phone, marketing_consent, marketing_consented_at)
  values(v_player_id, clean_name, clean_phone, coalesce(accepts_marketing,false),
    case when accepts_marketing then now() else null end)
  on conflict(phone) do update set
    player_id = v_player_id,
    name = excluded.name,
    marketing_consent = excluded.marketing_consent,
    marketing_consented_at = excluded.marketing_consented_at,
    privacy_accepted_at = now(),
    updated_at = now();

  return query select p.id, p.name, p.school, p.class_name, p.score, p.completed_count
    from public.players p
    where p.id = v_player_id;
end;
$$;

revoke all on function public.register_player(text,text,boolean) from public;
grant execute on function public.register_player(text,text,boolean) to anon;

-- Depois de criar o primeiro usuário em Authentication > Users, libere o acesso:
-- insert into public.campaign_admins(user_id)
-- select id from auth.users where email = 'coordenacao@exemplo.com';

