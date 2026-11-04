-- MVP de armazém: primeira versão com registo de produtos e localizações.
-- Execute UMA VEZ no SQL Editor de um projeto Supabase novo.
-- Segurança: todas as tabelas têm RLS; cada utilizador vê somente o seu armazém.
-- Em v1 é permitido um armazém por conta. Partilha de equipas requer nova migração.

create extension if not exists pgcrypto;
create sequence if not exists public.produtos_codigo_seq start with 1;
create sequence if not exists public.localizacoes_codigo_seq start with 1;

create table if not exists public.armazens (
  id uuid primary key default gen_random_uuid(),
  utilizador_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  nome text not null check (char_length(trim(nome)) between 2 and 120),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  armazem_id uuid not null references public.armazens(id) on delete restrict,
  codigo text not null unique default (
    'ARM-' || lpad(nextval('public.produtos_codigo_seq'::regclass)::text, 8, '0')
  ) check (codigo ~ '^ARM-[0-9]{8}$'),
  nome text not null check (char_length(trim(nome)) between 2 and 160),
  descricao text not null default '' check (char_length(descricao) <= 2000),
  unidade text not null default 'un' check (unidade in ('un', 'cx', 'kg', 'm', 'l')),
  stock_minimo integer not null default 0 check (stock_minimo >= 0),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (armazem_id, id)
);

create table if not exists public.localizacoes (
  id uuid primary key default gen_random_uuid(),
  armazem_id uuid not null references public.armazens(id) on delete restrict,
  codigo text not null unique default (
    'LOC-' || lpad(nextval('public.localizacoes_codigo_seq'::regclass)::text, 8, '0')
  ) check (codigo ~ '^LOC-[0-9]{8}$'),
  nome text not null check (char_length(trim(nome)) between 2 and 120),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (armazem_id, id)
);

-- Estrutura preparada para os próximos módulos.
-- Sem INSERT/UPDATE/DELETE atribuídos ao cliente. Movimentações futuras serão
-- executadas por funções SQL transacionais que validam o armazém e o stock.
create table if not exists public.stock_saldos (
  armazem_id uuid not null references public.armazens(id),
  produto_id uuid not null,
  localizacao_id uuid not null,
  quantidade numeric(15,3) not null default 0 check (quantidade >= 0),
  atualizado_em timestamptz not null default now(),
  primary key (produto_id, localizacao_id),
  foreign key (armazem_id, produto_id) references public.produtos(armazem_id,id),
  foreign key (armazem_id, localizacao_id) references public.localizacoes(armazem_id,id)
);

create table if not exists public.movimentos (
  id uuid primary key default gen_random_uuid(),
  armazem_id uuid not null references public.armazens(id),
  produto_id uuid not null,
  tipo text not null check (tipo in ('entrada','saida','transferencia','ajuste')),
  quantidade numeric(15,3) not null check (quantidade > 0),
  origem_id uuid,
  destino_id uuid,
  observacao text not null default '',
  efetuado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  foreign key (armazem_id, produto_id) references public.produtos(armazem_id,id),
  foreign key (armazem_id, origem_id) references public.localizacoes(armazem_id,id),
  foreign key (armazem_id, destino_id) references public.localizacoes(armazem_id,id),
  check (
    (tipo = 'entrada' and origem_id is null and destino_id is not null) or
    (tipo = 'saida' and origem_id is not null and destino_id is null) or
    (tipo = 'transferencia' and origem_id is not null and destino_id is not null and origem_id <> destino_id) or
    (tipo = 'ajuste' and (origem_id is not null or destino_id is not null))
  )
);

create table if not exists public.inventarios (
  id uuid primary key default gen_random_uuid(),
  armazem_id uuid not null references public.armazens(id),
  titulo text not null check (char_length(trim(titulo)) between 2 and 160),
  estado text not null default 'aberto' check (estado in ('aberto','fechado')),
  criado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now(),
  fechado_em timestamptz,
  unique (armazem_id,id)
);

create table if not exists public.contagens_inventario (
  id uuid primary key default gen_random_uuid(),
  armazem_id uuid not null,
  inventario_id uuid not null,
  produto_id uuid not null,
  localizacao_id uuid not null,
  quantidade_contada numeric(15,3) not null check (quantidade_contada >= 0),
  contado_por uuid not null references auth.users(id),
  contado_em timestamptz not null default now(),
  unique (inventario_id,produto_id,localizacao_id),
  foreign key (armazem_id,inventario_id) references public.inventarios(armazem_id,id),
  foreign key (armazem_id,produto_id) references public.produtos(armazem_id,id),
  foreign key (armazem_id,localizacao_id) references public.localizacoes(armazem_id,id)
);

create index if not exists produtos_armazem_idx on public.produtos(armazem_id, criado_em desc);
create index if not exists localizacoes_armazem_idx on public.localizacoes(armazem_id);
create index if not exists movimentos_armazem_idx on public.movimentos(armazem_id, criado_em desc);
create index if not exists inventarios_armazem_idx on public.inventarios(armazem_id);
create index if not exists contagens_armazem_idx on public.contagens_inventario(armazem_id);
create index if not exists stock_saldos_armazem_idx on public.stock_saldos(armazem_id);

create or replace function public.set_atualizado_em()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

create trigger armazens_atualizados before update on public.armazens
for each row execute function public.set_atualizado_em();
create trigger produtos_atualizados before update on public.produtos
for each row execute function public.set_atualizado_em();
create trigger localizacoes_atualizadas before update on public.localizacoes
for each row execute function public.set_atualizado_em();

alter table public.armazens enable row level security;
alter table public.produtos enable row level security;
alter table public.localizacoes enable row level security;
alter table public.stock_saldos enable row level security;
alter table public.movimentos enable row level security;
alter table public.inventarios enable row level security;
alter table public.contagens_inventario enable row level security;

-- Não confiar apenas nas políticas: restringir igualmente os GRANTs.
revoke all on public.armazens, public.produtos, public.localizacoes,
  public.stock_saldos, public.movimentos, public.inventarios,
  public.contagens_inventario from anon, authenticated;
revoke all on sequence public.produtos_codigo_seq, public.localizacoes_codigo_seq from anon, authenticated;

grant select on public.armazens, public.produtos, public.localizacoes,
  public.stock_saldos, public.movimentos, public.inventarios,
  public.contagens_inventario to authenticated;
grant insert (nome) on public.armazens to authenticated;
grant update (nome) on public.armazens to authenticated;
grant insert (armazem_id, nome, descricao, unidade, stock_minimo, ativo) on public.produtos to authenticated;
grant update (nome, descricao, unidade, stock_minimo, ativo) on public.produtos to authenticated;
grant insert (armazem_id, nome) on public.localizacoes to authenticated;
grant update (nome) on public.localizacoes to authenticated;
grant usage on sequence public.produtos_codigo_seq, public.localizacoes_codigo_seq to authenticated;

create policy "armazens_select_proprio" on public.armazens
  for select to authenticated using (utilizador_id = (select auth.uid()));
create policy "armazens_insert_proprio" on public.armazens
  for insert to authenticated with check (utilizador_id = (select auth.uid()));
create policy "armazens_update_proprio" on public.armazens
  for update to authenticated using (utilizador_id = (select auth.uid()))
  with check (utilizador_id = (select auth.uid()));

create policy "produtos_select_proprio" on public.produtos
  for select to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "produtos_insert_proprio" on public.produtos
  for insert to authenticated with check (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "produtos_update_proprio" on public.produtos
  for update to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );

create policy "localizacoes_select_proprio" on public.localizacoes
  for select to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "localizacoes_insert_proprio" on public.localizacoes
  for insert to authenticated with check (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "localizacoes_update_proprio" on public.localizacoes
  for update to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  ) with check (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );

-- Preparação segura para módulos seguintes: apenas SELECT, sem escrita.
create policy "stock_select_proprio" on public.stock_saldos
  for select to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "movimentos_select_proprio" on public.movimentos
  for select to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "inventarios_select_proprio" on public.inventarios
  for select to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
create policy "contagens_select_proprio" on public.contagens_inventario
  for select to authenticated using (
    exists (select 1 from public.armazens a where a.id = armazem_id and a.utilizador_id = (select auth.uid()))
  );
