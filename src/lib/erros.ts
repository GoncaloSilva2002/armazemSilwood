// Os erros do Supabase nem sempre são instâncias de Error: são objetos com
// message/code/details/hint. Esta função extrai sempre a mensagem real.
export function mensagemErro(e: unknown, alternativa: string) {
  if (!e || typeof e !== 'object') return typeof e === 'string' && e ? e : alternativa
  const { message, code, details, hint } = e as { message?: string; code?: string; details?: string; hint?: string }
  const texto = [message, details, hint].filter(Boolean).join(' — ') || alternativa
  const dica = dicaMigracao(code, message ?? '')
  return dica ? `${texto}. ${dica}` : texto
}

// Colunas/tabelas/funções em falta quase sempre significam uma migração por executar.
function dicaMigracao(code: string | undefined, message: string) {
  const falta = code === '42703' || code === '42P01' || code === '42883' || code === 'PGRST202' || code === 'PGRST204' || code === 'PGRST205'
  if (!falta) return ''
  if (/inventario|contagem|criado_por_email|ajustes_aplicados|nao_contado|quantidade_sistema/.test(message)) return 'Falta executar supabase/migrations/006_inventarios.sql no SQL Editor do Supabase.'
  if (message.includes('localizacao_id')) return 'Falta executar supabase/migrations/005_localizacao_produto.sql no SQL Editor do Supabase.'
  if (message.includes('registar_movimento') || message.includes('efetuado_por_email')) return 'Falta executar supabase/migrations/004_movimentos.sql no SQL Editor do Supabase.'
  return 'Confirma que executaste todas as migrações de supabase/migrations, por ordem.'
}
