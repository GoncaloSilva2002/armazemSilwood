-- Fase 2: entradas, saídas e transferências.
-- Execute no SQL Editor DEPOIS de 003_armazens_partilhados.sql. Pode ser executado de novo.
--
-- O cliente continua sem escrita direta em stock_saldos e movimentos: tudo passa pela
-- função registar_movimento, que valida a permissão, o produto, as localizações e o saldo,
-- e atualiza saldo + histórico na mesma transação.

-- Guardar o email de quem fez o movimento (o administrador geral pode não ser membro).
alter table public.movimentos add column if not exists efetuado_por_email text not null default '';

create index if not exists movimentos_produto_idx on public.movimentos(armazem_id, produto_id, criado_em desc);
create index if not exists stock_saldos_produto_idx on public.stock_saldos(armazem_id, produto_id);

-- Histórico imutável: nem a API nem funções futuras podem alterar ou apagar movimentos.
create or replace function public.bloquear_alteracao_movimentos()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'O histórico de movimentos não pode ser alterado nem apagado.' using errcode = '42501';
end;
$$;

drop trigger if exists movimentos_imutaveis on public.movimentos;
create trigger movimentos_imutaveis before update or delete on public.movimentos
for each row execute function public.bloquear_alteracao_movimentos();

-- Retira 'quantidade' de uma localização; falha se o saldo não chegar.
create or replace function public.retirar_stock(p_armazem uuid, p_produto uuid, p_localizacao uuid, p_quantidade numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_restante numeric;
begin
  update public.stock_saldos s
    set quantidade = s.quantidade - p_quantidade, atualizado_em = now()
    where s.armazem_id = p_armazem and s.produto_id = p_produto and s.localizacao_id = p_localizacao
      and s.quantidade >= p_quantidade
    returning s.quantidade into v_restante;
  if not found then
    raise exception 'Stock insuficiente na localização de origem.' using errcode = '23514';
  end if;
  if v_restante = 0 then
    delete from public.stock_saldos s
    where s.produto_id = p_produto and s.localizacao_id = p_localizacao and s.quantidade = 0;
  end if;
end;
$$;

create or replace function public.adicionar_stock(p_armazem uuid, p_produto uuid, p_localizacao uuid, p_quantidade numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.stock_saldos (armazem_id, produto_id, localizacao_id, quantidade)
  values (p_armazem, p_produto, p_localizacao, p_quantidade)
  on conflict (produto_id, localizacao_id) do update
    set quantidade = public.stock_saldos.quantidade + excluded.quantidade, atualizado_em = now();
end;
$$;

-- Regista uma entrada, saída ou transferência. Devolve o id do movimento.
create or replace function public.registar_movimento(
  p_armazem uuid,
  p_produto uuid,
  p_tipo text,
  p_quantidade numeric,
  p_origem uuid default null,
  p_destino uuid default null,
  p_observacao text default ''
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_papel text := public.papel_no_armazem(p_armazem);
  v_unidade text;
  v_ativo boolean;
  v_obs text := trim(coalesce(p_observacao, ''));
  v_email text;
  v_id uuid;
begin
  if v_papel is null or v_papel not in ('administrador','operador') then
    raise exception 'Não tens permissão para registar movimentos neste armazém.' using errcode = '42501';
  end if;
  if p_tipo is null or p_tipo not in ('entrada','saida','transferencia') then
    raise exception 'Tipo de movimento inválido.' using errcode = '22023';
  end if;
  if p_quantidade is null or p_quantidade <= 0 or p_quantidade > 999999999 then
    raise exception 'A quantidade tem de ser maior que zero.' using errcode = '22023';
  end if;
  if p_quantidade <> round(p_quantidade, 3) then
    raise exception 'A quantidade aceita no máximo 3 casas decimais.' using errcode = '22023';
  end if;
  if char_length(v_obs) > 500 then
    raise exception 'A observação tem no máximo 500 caracteres.' using errcode = '22023';
  end if;

  select p.unidade, p.ativo into v_unidade, v_ativo
  from public.produtos p where p.id = p_produto and p.armazem_id = p_armazem;
  if not found then
    raise exception 'Produto não encontrado neste armazém.' using errcode = 'P0002';
  end if;
  if v_unidade in ('un','cx') and p_quantidade <> trunc(p_quantidade) then
    raise exception 'Este produto é contado em unidades inteiras.' using errcode = '22023';
  end if;
  if p_tipo = 'entrada' and not v_ativo then
    raise exception 'Não é possível dar entrada de um produto inativo.' using errcode = '22023';
  end if;

  if p_tipo = 'entrada' then
    if p_destino is null or p_origem is not null then
      raise exception 'Uma entrada precisa apenas de localização de destino.' using errcode = '22023';
    end if;
  elsif p_tipo = 'saida' then
    if p_origem is null or p_destino is not null then
      raise exception 'Uma saída precisa apenas de localização de origem.' using errcode = '22023';
    end if;
  else
    if p_origem is null or p_destino is null then
      raise exception 'Uma transferência precisa de origem e destino.' using errcode = '22023';
    end if;
    if p_origem = p_destino then
      raise exception 'A origem e o destino têm de ser diferentes.' using errcode = '22023';
    end if;
  end if;

  if p_origem is not null and not exists (select 1 from public.localizacoes l where l.id = p_origem and l.armazem_id = p_armazem) then
    raise exception 'Localização de origem não encontrada neste armazém.' using errcode = 'P0002';
  end if;
  if p_destino is not null and not exists (select 1 from public.localizacoes l where l.id = p_destino and l.armazem_id = p_armazem) then
    raise exception 'Localização de destino não encontrada neste armazém.' using errcode = 'P0002';
  end if;

  if p_origem is not null then
    perform public.retirar_stock(p_armazem, p_produto, p_origem, p_quantidade);
  end if;
  if p_destino is not null then
    perform public.adicionar_stock(p_armazem, p_produto, p_destino, p_quantidade);
  end if;

  select coalesce(u.email, '') into v_email from auth.users u where u.id = (select auth.uid());

  insert into public.movimentos (armazem_id, produto_id, tipo, quantidade, origem_id, destino_id, observacao, efetuado_por, efetuado_por_email)
  values (p_armazem, p_produto, p_tipo, p_quantidade, p_origem, p_destino, v_obs, (select auth.uid()), coalesce(v_email, ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.bloquear_alteracao_movimentos(),
  public.retirar_stock(uuid, uuid, uuid, numeric),
  public.adicionar_stock(uuid, uuid, uuid, numeric),
  public.registar_movimento(uuid, uuid, text, numeric, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.registar_movimento(uuid, uuid, text, numeric, uuid, uuid, text) to authenticated;
