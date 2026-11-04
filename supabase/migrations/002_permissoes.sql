-- Utilizadores e permissões: vários utilizadores por armazém, com papéis e convites.
-- Execute no SQL Editor DEPOIS de 001_init.sql. Pode ser executado de novo sem efeitos duplicados.
--
-- Papéis:
--   administrador: tudo, incluindo gerir utilizadores e o nome do armazém.
--   operador:      cria e edita produtos e localizações.
--   consulta:      apenas leitura (pesquisa, leitura de códigos e etiquetas).
--
-- O cliente não escreve diretamente em membros nem convites: tudo passa por funções
-- que validam o papel de quem as chama. O responsável (criador) é sempre administrador.

create table if not exists public.membros_armazem (
  armazem_id uuid not null references public.armazens(id) on delete cascade,
  utilizador_id uuid not null references auth.users(id) on delete cascade,
  email text not null default '',
  papel text not null check (papel in ('administrador','operador','consulta')),
  adicionado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  primary key (armazem_id, utilizador_id)
);

create table if not exists public.convites_armazem (
  id uuid primary key default gen_random_uuid(),
  armazem_id uuid not null references public.armazens(id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  papel text not null check (papel in ('administrador','operador','consulta')),
  convidado_por uuid not null references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now(),
  unique (armazem_id, email)
);

create index if not exists membros_utilizador_idx on public.membros_armazem(utilizador_id);
create index if not exists convites_email_idx on public.convites_armazem(email);

alter table public.membros_armazem enable row level security;
alter table public.convites_armazem enable row level security;

revoke all on public.membros_armazem, public.convites_armazem from anon, authenticated;
grant select on public.membros_armazem, public.convites_armazem to authenticated;

-- Papel do utilizador atual num armazém (null = sem acesso).
-- security definer evita recursão nas políticas de membros_armazem.
create or replace function public.papel_no_armazem(p_armazem uuid)
returns text language sql stable security definer set search_path = '' as $$
  select m.papel from public.membros_armazem m
  where m.armazem_id = p_armazem and m.utilizador_id = (select auth.uid())
$$;

-- Quem cria um armazém fica automaticamente como administrador.
create or replace function public.adicionar_responsavel_como_membro()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.membros_armazem (armazem_id, utilizador_id, email, papel, adicionado_por)
  select new.id, new.utilizador_id, coalesce(u.email, ''), 'administrador', new.utilizador_id
  from auth.users u where u.id = new.utilizador_id
  on conflict (armazem_id, utilizador_id) do nothing;
  return new;
end;
$$;

drop trigger if exists armazens_responsavel_membro on public.armazens;
create trigger armazens_responsavel_membro after insert on public.armazens
for each row execute function public.adicionar_responsavel_como_membro();

-- Armazéns já existentes: o responsável passa a ser membro administrador.
insert into public.membros_armazem (armazem_id, utilizador_id, email, papel, adicionado_por)
select a.id, a.utilizador_id, coalesce(u.email, ''), 'administrador', a.utilizador_id
from public.armazens a join auth.users u on u.id = a.utilizador_id
on conflict (armazem_id, utilizador_id) do nothing;

-- Substituir as políticas "só o dono" por políticas baseadas no papel.
drop policy if exists "armazens_select_proprio" on public.armazens;
drop policy if exists "armazens_update_proprio" on public.armazens;
drop policy if exists "produtos_select_proprio" on public.produtos;
drop policy if exists "produtos_insert_proprio" on public.produtos;
drop policy if exists "produtos_update_proprio" on public.produtos;
drop policy if exists "localizacoes_select_proprio" on public.localizacoes;
drop policy if exists "localizacoes_insert_proprio" on public.localizacoes;
drop policy if exists "localizacoes_update_proprio" on public.localizacoes;
drop policy if exists "stock_select_proprio" on public.stock_saldos;
drop policy if exists "movimentos_select_proprio" on public.movimentos;
drop policy if exists "inventarios_select_proprio" on public.inventarios;
drop policy if exists "contagens_select_proprio" on public.contagens_inventario;

drop policy if exists "armazens_select_membro" on public.armazens;
drop policy if exists "armazens_update_admin" on public.armazens;
drop policy if exists "produtos_select_membro" on public.produtos;
drop policy if exists "produtos_insert_editor" on public.produtos;
drop policy if exists "produtos_update_editor" on public.produtos;
drop policy if exists "localizacoes_select_membro" on public.localizacoes;
drop policy if exists "localizacoes_insert_editor" on public.localizacoes;
drop policy if exists "localizacoes_update_editor" on public.localizacoes;
drop policy if exists "stock_select_membro" on public.stock_saldos;
drop policy if exists "movimentos_select_membro" on public.movimentos;
drop policy if exists "inventarios_select_membro" on public.inventarios;
drop policy if exists "contagens_select_membro" on public.contagens_inventario;
drop policy if exists "membros_select_membro" on public.membros_armazem;
drop policy if exists "convites_select_admin" on public.convites_armazem;

-- "armazens_insert_proprio" (001) mantém-se: cada conta continua a poder criar o seu armazém.
-- O responsável mantém-se no SELECT para o INSERT ... RETURNING funcionar antes do trigger.
create policy "armazens_select_membro" on public.armazens
  for select to authenticated using (
    utilizador_id = (select auth.uid()) or public.papel_no_armazem(id) is not null
  );
create policy "armazens_update_admin" on public.armazens
  for update to authenticated using (public.papel_no_armazem(id) = 'administrador')
  with check (public.papel_no_armazem(id) = 'administrador');

create policy "produtos_select_membro" on public.produtos
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);
create policy "produtos_insert_editor" on public.produtos
  for insert to authenticated with check (public.papel_no_armazem(armazem_id) in ('administrador','operador'));
create policy "produtos_update_editor" on public.produtos
  for update to authenticated using (public.papel_no_armazem(armazem_id) in ('administrador','operador'))
  with check (public.papel_no_armazem(armazem_id) in ('administrador','operador'));

create policy "localizacoes_select_membro" on public.localizacoes
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);
create policy "localizacoes_insert_editor" on public.localizacoes
  for insert to authenticated with check (public.papel_no_armazem(armazem_id) in ('administrador','operador'));
create policy "localizacoes_update_editor" on public.localizacoes
  for update to authenticated using (public.papel_no_armazem(armazem_id) in ('administrador','operador'))
  with check (public.papel_no_armazem(armazem_id) in ('administrador','operador'));

create policy "stock_select_membro" on public.stock_saldos
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);
create policy "movimentos_select_membro" on public.movimentos
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);
create policy "inventarios_select_membro" on public.inventarios
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);
create policy "contagens_select_membro" on public.contagens_inventario
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);

-- Todos os membros veem a equipa; só administradores veem os convites pendentes.
create policy "membros_select_membro" on public.membros_armazem
  for select to authenticated using (public.papel_no_armazem(armazem_id) is not null);
create policy "convites_select_admin" on public.convites_armazem
  for select to authenticated using (public.papel_no_armazem(armazem_id) = 'administrador');

-- Convidar (ou atualizar o papel de um convite pendente). Só administradores.
-- A resposta é igual quer o email já tenha conta ou não, para não revelar contas existentes.
create or replace function public.convidar_membro(p_armazem uuid, p_email text, p_papel text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if public.papel_no_armazem(p_armazem) is distinct from 'administrador' then
    raise exception 'Apenas administradores podem convidar utilizadores.' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('administrador','operador','consulta') then
    raise exception 'Permissão inválida.' using errcode = '22023';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Email inválido.' using errcode = '22023';
  end if;
  if exists (select 1 from public.membros_armazem m where m.armazem_id = p_armazem and lower(m.email) = v_email) then
    raise exception 'Este utilizador já tem acesso ao armazém.' using errcode = '23505';
  end if;
  insert into public.convites_armazem (armazem_id, email, papel, convidado_por)
  values (p_armazem, v_email, p_papel, (select auth.uid()))
  on conflict (armazem_id, email) do update
    set papel = excluded.papel, convidado_por = excluded.convidado_por, criado_em = now();
end;
$$;

create or replace function public.cancelar_convite(p_convite uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_armazem uuid;
begin
  select c.armazem_id into v_armazem from public.convites_armazem c where c.id = p_convite;
  if v_armazem is null or public.papel_no_armazem(v_armazem) is distinct from 'administrador' then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  delete from public.convites_armazem c where c.id = p_convite;
end;
$$;

create or replace function public.alterar_papel_membro(p_armazem uuid, p_utilizador uuid, p_papel text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.papel_no_armazem(p_armazem) is distinct from 'administrador' then
    raise exception 'Apenas administradores podem alterar permissões.' using errcode = '42501';
  end if;
  if p_papel is null or p_papel not in ('administrador','operador','consulta') then
    raise exception 'Permissão inválida.' using errcode = '22023';
  end if;
  if exists (select 1 from public.armazens a where a.id = p_armazem and a.utilizador_id = p_utilizador) then
    raise exception 'O responsável do armazém é sempre administrador.' using errcode = '42501';
  end if;
  update public.membros_armazem m set papel = p_papel
  where m.armazem_id = p_armazem and m.utilizador_id = p_utilizador;
  if not found then
    raise exception 'Utilizador não encontrado neste armazém.' using errcode = 'P0002';
  end if;
end;
$$;

-- Administradores removem outros membros; qualquer membro pode sair. O responsável nunca sai.
create or replace function public.remover_membro(p_armazem uuid, p_utilizador uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_utilizador is distinct from (select auth.uid())
     and public.papel_no_armazem(p_armazem) is distinct from 'administrador' then
    raise exception 'Apenas administradores podem remover utilizadores.' using errcode = '42501';
  end if;
  if exists (select 1 from public.armazens a where a.id = p_armazem and a.utilizador_id = p_utilizador) then
    raise exception 'O responsável do armazém não pode ser removido.' using errcode = '42501';
  end if;
  delete from public.membros_armazem m
  where m.armazem_id = p_armazem and m.utilizador_id = p_utilizador;
  if not found then
    raise exception 'Utilizador não encontrado neste armazém.' using errcode = 'P0002';
  end if;
end;
$$;

-- Convites dirigidos ao email (confirmado) do utilizador atual.
create or replace function public.meus_convites()
returns table (id uuid, armazem_id uuid, armazem_nome text, papel text, criado_em timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.armazem_id, a.nome, c.papel, c.criado_em
  from public.convites_armazem c
  join public.armazens a on a.id = c.armazem_id
  join auth.users u on u.id = (select auth.uid())
  where u.email_confirmed_at is not null and lower(u.email) = c.email
  order by c.criado_em
$$;

create or replace function public.responder_convite(p_convite uuid, p_aceitar boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_convite public.convites_armazem;
begin
  select lower(u.email) into v_email from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
  select * into v_convite from public.convites_armazem c
  where c.id = p_convite and c.email = v_email;
  if not found then
    raise exception 'Convite não encontrado.' using errcode = 'P0002';
  end if;
  if p_aceitar then
    insert into public.membros_armazem (armazem_id, utilizador_id, email, papel, adicionado_por)
    values (v_convite.armazem_id, (select auth.uid()), v_email, v_convite.papel, v_convite.convidado_por)
    on conflict (armazem_id, utilizador_id) do nothing;
  end if;
  delete from public.convites_armazem c where c.id = p_convite;
end;
$$;

revoke all on function public.papel_no_armazem(uuid), public.adicionar_responsavel_como_membro(),
  public.convidar_membro(uuid, text, text), public.cancelar_convite(uuid),
  public.alterar_papel_membro(uuid, uuid, text), public.remover_membro(uuid, uuid),
  public.meus_convites(), public.responder_convite(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.papel_no_armazem(uuid),
  public.convidar_membro(uuid, text, text), public.cancelar_convite(uuid),
  public.alterar_papel_membro(uuid, uuid, text), public.remover_membro(uuid, uuid),
  public.meus_convites(), public.responder_convite(uuid, boolean)
  to authenticated;
