import type { Papel } from './types'

// Serve apenas para mostrar ou esconder opções na interface.
// Quem decide o que cada papel pode fazer são as políticas RLS (002_permissoes.sql).
export const papeis: Record<Papel, { nome: string; descricao: string }> = {
  administrador: { nome: 'Administrador', descricao: 'Faz tudo, incluindo validar inventários, convidar utilizadores e alterar permissões.' },
  operador: { nome: 'Operador', descricao: 'Cria e edita produtos e localizações e regista entradas, saídas, transferências e contagens de inventário.' },
  consulta: { nome: 'Consulta', descricao: 'Só consulta: pesquisa, vê o stock, lê códigos e imprime etiquetas.' }
}

export const listaPapeis = Object.keys(papeis) as Papel[]

export function podeEditarCatalogo(papel: Papel) {
  return papel === 'administrador' || papel === 'operador'
}

export function podeMovimentar(papel: Papel) {
  return papel === 'administrador' || papel === 'operador'
}

// Contar: administrador ou operador. Validar (fechar com ajustes) ou cancelar: só administrador.
export function podeContar(papel: Papel) {
  return papel === 'administrador' || papel === 'operador'
}

export function podeValidarInventario(papel: Papel) {
  return papel === 'administrador'
}
