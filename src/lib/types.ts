export interface Armazem {
  id: string
  utilizador_id: string
  nome: string
  criado_em: string
}

export interface Produto {
  id: string
  armazem_id: string
  codigo: string
  nome: string
  descricao: string
  unidade: string
  stock_minimo: number
  ativo: boolean
  localizacao_id: string | null
  criado_em: string
}

export interface Localizacao {
  id: string
  armazem_id: string
  codigo: string
  nome: string
  criado_em: string
}

export type ProdutoFormulario = Pick<Produto, 'nome' | 'descricao' | 'unidade' | 'stock_minimo' | 'ativo' | 'localizacao_id'>

export type Papel = 'administrador' | 'operador' | 'consulta'

export interface ArmazemAcesso extends Armazem {
  papel: Papel
}

export interface Membro {
  armazem_id: string
  utilizador_id: string
  email: string
  papel: Papel
  criado_em: string
}

export interface ConviteEnviado {
  id: string
  armazem_id: string
  email: string
  papel: Papel
  criado_em: string
}

export interface ConviteRecebido {
  id: string
  armazem_id: string
  armazem_nome: string
  papel: Papel
  criado_em: string
}

export interface UtilizadorRegistado {
  id: string
  email: string
  criado_em: string
  admin_geral: boolean
}

export type TipoMovimento = 'entrada' | 'saida' | 'transferencia' | 'ajuste'

export interface StockSaldo {
  armazem_id: string
  produto_id: string
  localizacao_id: string
  quantidade: number
  atualizado_em: string
}

export interface Movimento {
  id: string
  armazem_id: string
  produto_id: string
  tipo: TipoMovimento
  quantidade: number
  origem_id: string | null
  destino_id: string | null
  observacao: string
  efetuado_por: string
  efetuado_por_email: string
  criado_em: string
}
