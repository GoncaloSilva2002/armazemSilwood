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
