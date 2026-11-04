import type { Papel } from './types'

// Serve apenas para mostrar ou esconder opções na interface.
// Quem decide o que cada papel pode fazer são as políticas RLS (002_permissoes.sql).
export const papeis: Record<Papel, { nome: string; descricao: string }> = {
  administrador: { nome: 'Administrador', descricao: 'Faz tudo, incluindo convidar utilizadores e alterar permissões.' },
  operador: { nome: 'Operador', descricao: 'Cria e edita produtos e localizações.' },
  consulta: { nome: 'Consulta', descricao: 'Só consulta: pesquisa, lê códigos e imprime etiquetas.' }
}

export const listaPapeis = Object.keys(papeis) as Papel[]

export function podeEditarCatalogo(papel: Papel) {
  return papel === 'administrador' || papel === 'operador'
}
