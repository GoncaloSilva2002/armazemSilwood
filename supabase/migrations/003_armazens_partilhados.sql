-- Armazéns partilhados: as contas deixam de ter um armazém próprio automático.
-- Os administradores gerais criam armazéns e associam utilizadores a cada um.
-- Execute no SQL Editor DEPOIS de 001_init.sql e 002_permissoes.sql. Pode ser executado de novo.
--
-- Administrador geral: vê e gere todos os armazéns (como administrador de cada um),
-- cria armazéns, associa utilizadores registados e nomeia outros administradores gerais.

create table if not exists public.administradores_gerais (
  utilizador_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table public.administradores_gerais enable row level security;
revoke all on public.administradores_gerais from anon, authenticated;
grant select on public.administradores_gerais to authenticated;

-- Projeto com dados: quem criou o armazém mais antigo passa a administrador geral.
-- Projeto vazio: o primeiro utilizador torna-se administrador geral pela app (tornar_me_admin_geral).
insert into public.administradores_gerais (utilizador_id)
select a.utilizador_id from public.armazens a
where not exists (select 1 from public.administradores_gerais)
order by a.criado_em
limit 1;

create or replace function public.e_admin_geral()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.administradores_gerais g where g.utilizador_id = (select auth.uid()))
$$;

-- O administrador geral é administrador de todos os armazéns.
-- (Sem verificar se o armazém existe: o INSERT ... RETURNING ainda não o vê.)
create or replace function public.papel_no_armazem(p_armazem uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when public.e_admin_geral() then 'administrador' else (
    select m.papel from public.membros_armazem m
    where m.armazem_id = p_armazem and m.utilizador_id = (select auth.uid())
  ) end
$$;

-- utilizador_id passa a significar apenas "criado por": já não é um armazém por conta.
alter table public.armazens drop constraint if exists armazens_utilizador_id_key;
drop trigger if exists armazens_responsavel_membro on public.armazens;

drop policy if exists "armazens_select_membro" on public.armazens;
drop policy if exists "armazens_insert_proprio" on public.armazens;
drop policy if exists "armazens_insert_admin_geral" on public.armazens;
drop policy if exists "admins_gerais_select" on public.administradores_gerais;

create policy "armazens_select_membro" on public.armazens
  for select to authenticated using (public.papel_no_armazem(id) is not null);
create policy "armazens_insert_admin_geral" on public.armazens
  for insert to authenticated with check (public.e_admin_geral());
create policy "admins_gerais_select" on public.administradores_gerais
  for select to authenticated using (utilizador_id = (select auth.uid()) or public.e_admin_geral());

-- Sem "responsável" fixo: os administradores gerais garantem que cada armazém tem sempre quem o gira.
create or replace function public.alterar_papel_membro(p_armazem uuid, p_utilizador uuid, p_papel text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.papel_no_armazem(p_armazem) is distinct from 'administrador' then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('administrador','operador','consulta') then
    raise exception 'Permissão inválida.' using errcode = '22023';
  end if;
  update public.membros_armazem m set papel = p_papel
  where m.armazem_id = p_armazem and m.utilizador_id = p_utilizador;
  if not found then
    raise exception 'Utilizador não encontrado neste armazém.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.remover_membro(p_armazem uuid, p_utilizador uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_utilizador is distinct from (select auth.uid())
     and public.papel_no_armazem(p_armazem) is distinct from 'administrador' then
    raise exception 'Apenas administradores podem remover utilizadores.' using errcode = '42501';
  end if;
  delete from public.membros_armazem m
  where m.armazem_id = p_armazem and m.utilizador_id = p_utilizador;
  if not found then
    raise exception 'Utilizador não encontrado neste armazém.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.existe_admin_geral()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.administradores_gerais)
$$;

-- Configuração inicial: só funciona enquanto não existir nenhum administrador geral.
create or replace function public.tornar_me_admin_geral()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sessão inválida.' using errcode = '42501';
  end if;
  lock table public.administradores_gerais in exclusive mode;
  if exists (select 1 from public.administradores_gerais) then
    raise exception 'Já existe um administrador geral. Pede-lhe acesso a um armazém.' using errcode = '42501';
  end if;
  insert into public.administradores_gerais (utilizador_id) values ((select auth.uid()));
end;
$$;

create or replace function public.definir_admin_geral(p_utilizador uuid, p_ativo boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.e_admin_geral() then
    raise exception 'Apenas administradores gerais podem fazer esta alteração.' using errcode = '42501';
  end if;
  lock table public.administradores_gerais in exclusive mode;
  if p_ativo then
    if not exists (select 1 from auth.users u where u.id = p_utilizador) then
      raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
    end if;
    insert into public.administradores_gerais (utilizador_id) values (p_utilizador)
    on conflict (utilizador_id) do nothing;
  else
    if not exists (select 1 from public.administradores_gerais g where g.utilizador_id <> p_utilizador) then
      raise exception 'Tem de existir pelo menos um administrador geral.' using errcode = '42501';
    end if;
    delete from public.administradores_gerais g where g.utilizador_id = p_utilizador;
  end if;
end;
$$;

-- Lista de contas registadas, para o administrador geral as associar a armazéns.
create or replace function public.listar_utilizadores()
returns table (id uuid, email text, criado_em timestamptz, admin_geral boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_admin_geral() then
    raise exception 'Apenas administradores gerais podem ver os utilizadores.' using errcode = '42501';
  end if;
  return query
    select u.id, coalesce(u.email, '')::text, u.created_at,
      exists (select 1 from public.administradores_gerais g where g.utilizador_id = u.id)
    from auth.users u
    order by u.email;
end;
$$;

-- Associa diretamente uma conta registada a um armazém (ou altera a permissão).
create or replace function public.associar_utilizador(p_armazem uuid, p_utilizador uuid, p_papel text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
begin
  if not public.e_admin_geral() then
    raise exception 'Apenas administradores gerais podem associar utilizadores.' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('administrador','operador','consulta') then
    raise exception 'Permissão inválida.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.armazens a where a.id = p_armazem) then
    raise exception 'Armazém não encontrado.' using errcode = 'P0002';
  end if;
  select lower(coalesce(u.email, '')) into v_email from auth.users u where u.id = p_utilizador;
  if not found then
    raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
  end if;
  insert into public.membros_armazem (armazem_id, utilizador_id, email, papel, adicionado_por)
  values (p_armazem, p_utilizador, v_email, p_papel, (select auth.uid()))
  on conflict (armazem_id, utilizador_id) do update set papel = excluded.papel;
  delete from public.convites_armazem c where c.armazem_id = p_armazem and c.email = v_email;
end;
$$;

revoke all on function public.e_admin_geral(), public.existe_admin_geral(), public.tornar_me_admin_geral(),
  public.definir_admin_geral(uuid, boolean), public.listar_utilizadores(),
  public.associar_utilizador(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.e_admin_geral(), public.existe_admin_geral(), public.tornar_me_admin_geral(),
  public.definir_admin_geral(uuid, boolean), public.listar_utilizadores(),
  public.associar_utilizador(uuid, uuid, text)
  to authenticated;
