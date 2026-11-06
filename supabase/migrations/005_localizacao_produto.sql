-- Localização habitual do produto (onde costuma estar arrumado no armazém).
-- Execute no SQL Editor DEPOIS de 004_movimentos.sql. Pode ser executado de novo.
--
-- É opcional e apenas indicativa: o stock real por localização continua em stock_saldos.
-- A chave estrangeira composta garante que a localização pertence ao mesmo armazém do produto.

alter table public.produtos add column if not exists localizacao_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produtos_localizacao_fk') then
    alter table public.produtos
      add constraint produtos_localizacao_fk
      foreign key (armazem_id, localizacao_id) references public.localizacoes(armazem_id, id);
  end if;
end;
$$;

create index if not exists produtos_localizacao_idx on public.produtos(armazem_id, localizacao_id);

grant insert (localizacao_id) on public.produtos to authenticated;
grant update (localizacao_id) on public.produtos to authenticated;
