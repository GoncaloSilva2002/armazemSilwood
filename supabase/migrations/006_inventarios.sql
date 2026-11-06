-- Fase 3: inventários (contagem física) e ajustes validados.
-- Execute no SQL Editor DEPOIS de 005_localizacao_produto.sql. Pode ser executado de novo.
--
-- Fluxo:
--   1. Administrador ou operador abre um inventário (todo o armazém ou uma localização).
--   2. Administradores e operadores registam contagens por produto e localização.
--   3. Só um administrador fecha o inventário. Ao fechar, as diferenças entre o contado e o
--      saldo atual são aplicadas como movimentos do tipo 'ajuste' (histórico imutável).
--      Em alternativa, o inventário pode ser cancelado sem mexer no stock.
--
-- O cliente continua sem escrita direta nestas tabelas: tudo passa pelas funções abaixo.

-- ---------------------------------------------------------------- estrutura
alter table public.inventarios add column if not exists localizacao_id uuid;
alter table public.inventarios add column if not exists observacao text not null default '';
alter table public.inventarios add column if not exists criado_por_email text not null default '';
alter table public.inventarios add column if not exists fechado_por uuid references auth.users(id);
alter table public.inventarios add column if not exists fechado_por_email text not null default '';
alter table public.inventarios add column if not exists ajustes_aplicados integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventarios_localizacao_fk') then
    alter table public.inventarios
      add constraint inventarios_localizacao_fk
      foreign key (armazem_id, localizacao_id) references public.localizacoes(armazem_id, id);
  end if;
  -- Novo estado 'cancelado'.
  if exists (select 1 from pg_constraint where conname = 'inventarios_estado_check') then
    alter table public.inventarios drop constraint inventarios_estado_check;
  end if;
  alter table public.inventarios
    add constraint inventarios_estado_check check (estado in ('aberto','fechado','cancelado'));
end;
$$;

-- Só um inventário aberto de cada vez por armazém (evita contagens cruzadas).
create unique index if not exists inventarios_um_aberto_idx
  on public.inventarios(armazem_id) where estado = 'aberto';
create index if not exists contagens_inventario_idx on public.contagens_inventario(inventario_id);

alter table public.contagens_inventario add column if not exists contado_por_email text not null default '';
-- Preenchidos ao fechar: saldo do sistema nesse momento e diferença aplicada.
alter table public.contagens_inventario add column if not exists quantidade_sistema numeric(15,3);
alter table public.contagens_inventario add column if not exists diferenca numeric(15,3);
-- Linhas criadas no fecho para artigos não contados que foram postos a zero.
alter table public.contagens_inventario add column if not exists nao_contado boolean not null default false;

-- Ligação dos ajustes ao inventário que os originou.
alter table public.movimentos add column if not exists inventario_id uuid references public.inventarios(id);
create index if not exists movimentos_inventario_idx on public.movimentos(inventario_id) where inventario_id is not null;

-- ---------------------------------------------------------------- auxiliares
create or replace function public.email_atual()
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select u.email from auth.users u where u.id = (select auth.uid())), '');
$$;

create or replace function public.validar_quantidade_contagem(p_produto_unidade text, p_quantidade numeric)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_quantidade is null or p_quantidade < 0 or p_quantidade > 999999999 then
    raise exception 'A quantidade contada tem de ser zero ou mais.' using errcode = '22023';
  end if;
  if p_quantidade <> round(p_quantidade, 3) then
    raise exception 'A quantidade aceita no máximo 3 casas decimais.' using errcode = '22023';
  end if;
  if p_produto_unidade in ('un','cx') and p_quantidade <> trunc(p_quantidade) then
    raise exception 'Este produto é contado em unidades inteiras.' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------- abrir
create or replace function public.abrir_inventario(
  p_armazem uuid,
  p_titulo text,
  p_localizacao uuid default null,
  p_observacao text default ''
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_papel text := public.papel_no_armazem(p_armazem);
  v_titulo text := trim(coalesce(p_titulo, ''));
  v_obs text := trim(coalesce(p_observacao, ''));
  v_id uuid;
begin
  if v_papel is null or v_papel not in ('administrador','operador') then
    raise exception 'Não tens permissão para abrir inventários neste armazém.' using errcode = '42501';
  end if;
  if char_length(v_titulo) not between 2 and 160 then
    raise exception 'O título tem entre 2 e 160 caracteres.' using errcode = '22023';
  end if;
  if char_length(v_obs) > 500 then
    raise exception 'A observação tem no máximo 500 caracteres.' using errcode = '22023';
  end if;
  if p_localizacao is not null and not exists (
    select 1 from public.localizacoes l where l.id = p_localizacao and l.armazem_id = p_armazem
  ) then
    raise exception 'Localização não encontrada neste armazém.' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.inventarios i where i.armazem_id = p_armazem and i.estado = 'aberto') then
    raise exception 'Já existe um inventário aberto neste armazém. Fecha-o ou cancela-o primeiro.' using errcode = '23505';
  end if;

  insert into public.inventarios (armazem_id, titulo, estado, localizacao_id, observacao, criado_por, criado_por_email)
  values (p_armazem, v_titulo, 'aberto', p_localizacao, v_obs, (select auth.uid()), public.email_atual())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------- contar
-- p_somar = true soma à contagem existente (útil para "picar" artigo a artigo);
-- caso contrário substitui o valor contado.
create or replace function public.registar_contagem(
  p_inventario uuid,
  p_produto uuid,
  p_localizacao uuid,
  p_quantidade numeric,
  p_somar boolean default false
)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.inventarios%rowtype;
  v_papel text;
  v_unidade text;
  v_atual numeric;
  v_nova numeric;
begin
  select * into v_inv from public.inventarios i where i.id = p_inventario for share;
  if not found then
    raise exception 'Inventário não encontrado.' using errcode = 'P0002';
  end if;
  v_papel := public.papel_no_armazem(v_inv.armazem_id);
  if v_papel is null or v_papel not in ('administrador','operador') then
    raise exception 'Não tens permissão para contar neste armazém.' using errcode = '42501';
  end if;
  if v_inv.estado <> 'aberto' then
    raise exception 'Este inventário já não está aberto.' using errcode = '22023';
  end if;

  select p.unidade into v_unidade from public.produtos p where p.id = p_produto and p.armazem_id = v_inv.armazem_id;
  if not found then
    raise exception 'Produto não encontrado neste armazém.' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.localizacoes l where l.id = p_localizacao and l.armazem_id = v_inv.armazem_id) then
    raise exception 'Localização não encontrada neste armazém.' using errcode = 'P0002';
  end if;
  if v_inv.localizacao_id is not null and p_localizacao <> v_inv.localizacao_id then
    raise exception 'Este inventário só abrange uma localização. Lê a etiqueta dessa localização.' using errcode = '22023';
  end if;

  select c.quantidade_contada into v_atual from public.contagens_inventario c
  where c.inventario_id = p_inventario and c.produto_id = p_produto and c.localizacao_id = p_localizacao
  for update;

  v_nova := case when coalesce(p_somar, false) then coalesce(v_atual, 0) + p_quantidade else p_quantidade end;
  perform public.validar_quantidade_contagem(v_unidade, v_nova);

  insert into public.contagens_inventario (armazem_id, inventario_id, produto_id, localizacao_id, quantidade_contada, contado_por, contado_por_email, contado_em)
  values (v_inv.armazem_id, p_inventario, p_produto, p_localizacao, v_nova, (select auth.uid()), public.email_atual(), now())
  on conflict (inventario_id, produto_id, localizacao_id) do update
    set quantidade_contada = excluded.quantidade_contada,
        contado_por = excluded.contado_por,
        contado_por_email = excluded.contado_por_email,
        contado_em = now();
  return v_nova;
end;
$$;

create or replace function public.remover_contagem(p_inventario uuid, p_produto uuid, p_localizacao uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.inventarios%rowtype;
  v_papel text;
begin
  select * into v_inv from public.inventarios i where i.id = p_inventario for share;
  if not found then
    raise exception 'Inventário não encontrado.' using errcode = 'P0002';
  end if;
  v_papel := public.papel_no_armazem(v_inv.armazem_id);
  if v_papel is null or v_papel not in ('administrador','operador') then
    raise exception 'Não tens permissão para alterar contagens neste armazém.' using errcode = '42501';
  end if;
  if v_inv.estado <> 'aberto' then
    raise exception 'Este inventário já não está aberto.' using errcode = '22023';
  end if;
  delete from public.contagens_inventario c
  where c.inventario_id = p_inventario and c.produto_id = p_produto and c.localizacao_id = p_localizacao;
end;
$$;

-- ---------------------------------------------------------------- fechar
-- Aplica as diferenças como ajustes. Com p_zerar_nao_contados, os artigos com saldo
-- nas localizações contadas (ou na localização do inventário) que não foram contados
-- passam a zero. Devolve o número de ajustes aplicados.
create or replace function public.fechar_inventario(p_inventario uuid, p_zerar_nao_contados boolean default false)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.inventarios%rowtype;
  v_email text := public.email_atual();
  v_uid uuid := (select auth.uid());
  v_obs text;
  v_c record;
  v_sistema numeric;
  v_dif numeric;
  v_n integer := 0;
begin
  select * into v_inv from public.inventarios i where i.id = p_inventario for update;
  if not found then
    raise exception 'Inventário não encontrado.' using errcode = 'P0002';
  end if;
  if public.papel_no_armazem(v_inv.armazem_id) is distinct from 'administrador' then
    raise exception 'Só um administrador pode validar e fechar inventários.' using errcode = '42501';
  end if;
  if v_inv.estado <> 'aberto' then
    raise exception 'Este inventário já não está aberto.' using errcode = '22023';
  end if;

  v_obs := left('Inventário: ' || v_inv.titulo, 500);

  -- Artigos não contados passam a ser contagens a zero (marcadas como não contadas).
  if coalesce(p_zerar_nao_contados, false) then
    insert into public.contagens_inventario (armazem_id, inventario_id, produto_id, localizacao_id, quantidade_contada, contado_por, contado_por_email, nao_contado)
    select s.armazem_id, p_inventario, s.produto_id, s.localizacao_id, 0, v_uid, v_email, true
    from public.stock_saldos s
    where s.armazem_id = v_inv.armazem_id and s.quantidade > 0
      and (
        (v_inv.localizacao_id is not null and s.localizacao_id = v_inv.localizacao_id)
        or (v_inv.localizacao_id is null and s.localizacao_id in (
          select c.localizacao_id from public.contagens_inventario c where c.inventario_id = p_inventario))
      )
      and not exists (
        select 1 from public.contagens_inventario c
        where c.inventario_id = p_inventario and c.produto_id = s.produto_id and c.localizacao_id = s.localizacao_id)
    on conflict (inventario_id, produto_id, localizacao_id) do nothing;
  end if;

  for v_c in
    select c.id, c.produto_id, c.localizacao_id, c.quantidade_contada
    from public.contagens_inventario c
    where c.inventario_id = p_inventario
    order by c.produto_id, c.localizacao_id
  loop
    select s.quantidade into v_sistema from public.stock_saldos s
    where s.produto_id = v_c.produto_id and s.localizacao_id = v_c.localizacao_id
    for update;
    v_sistema := coalesce(v_sistema, 0);
    v_dif := v_c.quantidade_contada - v_sistema;

    if v_dif > 0 then
      perform public.adicionar_stock(v_inv.armazem_id, v_c.produto_id, v_c.localizacao_id, v_dif);
      insert into public.movimentos (armazem_id, produto_id, tipo, quantidade, origem_id, destino_id, observacao, efetuado_por, efetuado_por_email, inventario_id)
      values (v_inv.armazem_id, v_c.produto_id, 'ajuste', v_dif, null, v_c.localizacao_id, v_obs, v_uid, v_email, p_inventario);
      v_n := v_n + 1;
    elsif v_dif < 0 then
      perform public.retirar_stock(v_inv.armazem_id, v_c.produto_id, v_c.localizacao_id, -v_dif);
      insert into public.movimentos (armazem_id, produto_id, tipo, quantidade, origem_id, destino_id, observacao, efetuado_por, efetuado_por_email, inventario_id)
      values (v_inv.armazem_id, v_c.produto_id, 'ajuste', -v_dif, v_c.localizacao_id, null, v_obs, v_uid, v_email, p_inventario);
      v_n := v_n + 1;
    end if;

    update public.contagens_inventario set quantidade_sistema = v_sistema, diferenca = v_dif where id = v_c.id;
  end loop;

  update public.inventarios
    set estado = 'fechado', fechado_em = now(), fechado_por = v_uid, fechado_por_email = v_email, ajustes_aplicados = v_n
    where id = p_inventario;
  return v_n;
end;
$$;

create or replace function public.cancelar_inventario(p_inventario uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_inv public.inventarios%rowtype;
begin
  select * into v_inv from public.inventarios i where i.id = p_inventario for update;
  if not found then
    raise exception 'Inventário não encontrado.' using errcode = 'P0002';
  end if;
  if public.papel_no_armazem(v_inv.armazem_id) is distinct from 'administrador' then
    raise exception 'Só um administrador pode cancelar inventários.' using errcode = '42501';
  end if;
  if v_inv.estado <> 'aberto' then
    raise exception 'Este inventário já não está aberto.' using errcode = '22023';
  end if;
  update public.inventarios
    set estado = 'cancelado', fechado_em = now(), fechado_por = (select auth.uid()), fechado_por_email = public.email_atual()
    where id = p_inventario;
end;
$$;

-- Inventários fechados/cancelados e as suas contagens ficam imutáveis.
create or replace function public.bloquear_contagem_fechada()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_estado text;
begin
  select i.estado into v_estado from public.inventarios i
  where i.id = coalesce(new.inventario_id, old.inventario_id);
  -- Durante o fecho a função atualiza o próprio inventário só no fim, por isso ainda está 'aberto'.
  if v_estado is distinct from 'aberto' then
    raise exception 'As contagens de um inventário fechado não podem ser alteradas.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists contagens_imutaveis on public.contagens_inventario;
create trigger contagens_imutaveis before insert or update or delete on public.contagens_inventario
for each row execute function public.bloquear_contagem_fechada();

-- ---------------------------------------------------------------- permissões
revoke all on function public.email_atual(),
  public.validar_quantidade_contagem(text, numeric),
  public.abrir_inventario(uuid, text, uuid, text),
  public.registar_contagem(uuid, uuid, uuid, numeric, boolean),
  public.remover_contagem(uuid, uuid, uuid),
  public.fechar_inventario(uuid, boolean),
  public.cancelar_inventario(uuid),
  public.bloquear_contagem_fechada()
  from public, anon, authenticated;
grant execute on function public.abrir_inventario(uuid, text, uuid, text),
  public.registar_contagem(uuid, uuid, uuid, numeric, boolean),
  public.remover_contagem(uuid, uuid, uuid),
  public.fechar_inventario(uuid, boolean),
  public.cancelar_inventario(uuid)
  to authenticated;
