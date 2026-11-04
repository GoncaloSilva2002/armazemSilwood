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
  criado_em: string
}

export interface Localizacao {
  id: string
  armazem_id: string
  codigo: string
  nome: string
  criado_em: string
}

export type ProdutoFormulario = Pick<Produto, 'nome' | 'descricao' | 'unidade' | 'stock_minimo' | 'ativo'>

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
