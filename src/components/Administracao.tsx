import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, CheckCircle2, Info, Plus, ShieldCheck, Users, Warehouse, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { mensagemErro } from '../lib/erros'
import type { ArmazemAcesso, UtilizadorRegistado } from '../lib/types'

export default function Administracao({ armazens, utilizadorId, onCriado, onAbrir }: {
  armazens: ArmazemAcesso[]
  utilizadorId: string
  onCriado: (id: string) => Promise<void>
  onAbrir: (id: string, pagina: 'inicio' | 'equipa') => void
}) {
  const [utilizadores, setUtilizadores] = useState<UtilizadorRegistado[]>([])
  const [membros, setMembros] = useState<{ armazem_id: string; utilizador_id: string }[]>([])
  const [nome, setNome] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const carregar = useCallback(async () => {
    if (!supabase) return
    try {
      const [u, m] = await Promise.all([
        supabase.rpc('listar_utilizadores'),
        supabase.from('membros_armazem').select('armazem_id, utilizador_id')
      ])
      if (u.error) throw u.error
      if (m.error) throw m.error
      setUtilizadores((u.data || []) as UtilizadorRegistado[])
      setMembros((m.data || []) as { armazem_id: string; utilizador_id: string }[])
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível carregar os utilizadores.'))
    }
  }, [])

  useEffect(() => { void carregar() }, [carregar, armazens.length])

  async function criar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    const limpo = nome.trim()
    if (limpo.length < 2) return setErro('O nome do armazém precisa de pelo menos 2 caracteres.')
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { data, error } = await supabase.from('armazens').insert({ nome: limpo }).select('id').single()
      if (error) throw error
      setNome('')
      await onCriado((data as { id: string }).id)
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível criar o armazém.'))
    } finally { setOcupado(false) }
  }

  async function alterarAdminGeral(u: UtilizadorRegistado) {
    if (!supabase) return
    const ativo = !u.admin_geral
    if (!ativo && u.id === utilizadorId && !window.confirm('Vais deixar de ser administrador geral e perder acesso a esta página. Continuar?')) return
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { error } = await supabase.rpc('definir_admin_geral', { p_utilizador: u.id, p_ativo: ativo })
      if (error) throw error
      if (u.id === utilizadorId) return window.location.reload()
      await carregar()
      setAviso(ativo ? `${u.email} é agora administrador geral.` : `${u.email} deixou de ser administrador geral.`)
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível alterar o administrador geral.'))
    } finally { setOcupado(false) }
  }

  const nomeArmazem = new Map(armazens.map(a => [a.id, a.nome]))

  return <>
    <div className="page-header"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h1>Armazéns e utilizadores</h1><p>Cria armazéns e escolhe quem tem acesso a cada um. Os utilizadores só veem os armazéns a que estão associados.</p></div></div>
    {erro && <div className="feedback error global-msg"><Info size={18}/><span>{erro}</span><button aria-label="Fechar erro" onClick={() => setErro('')}><X size={16}/></button></div>}
    {aviso && <div className="feedback success global-msg"><CheckCircle2 size={18}/><span>{aviso}</span><button aria-label="Fechar aviso" onClick={() => setAviso('')}><X size={16}/></button></div>}
    <div className="location-grid">
      <section className="list-panel creation-panel">
        <h2>Novo armazém</h2><p>Depois de criar, associa os utilizadores que vão trabalhar nele.</p>
        <form className="form-stack" onSubmit={criar}>
          <label>Nome do armazém<input required minLength={2} maxLength={120} value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Armazém Lisboa"/></label>
          <button className="btn primary full" disabled={ocupado} type="submit"><Plus size={17}/> Criar armazém</button>
        </form>
      </section>
      <div className="team-column">
        <section className="list-panel">
          <div className="list-toolbar"><h2>Armazéns</h2><span className="list-count">{armazens.length}</span></div>
          {!armazens.length ? <div className="empty-state compact"><Warehouse size={29}/><h3>Ainda não há armazéns</h3><p>Cria o primeiro armazém no formulário ao lado.</p></div> :
            <div className="items-list">{armazens.map(a => {
              const total = membros.filter(m => m.armazem_id === a.id).length
              return <article className="item-row" key={a.id}><span className="item-icon"><Warehouse size={20}/></span><div className="item-main"><strong>{a.nome}</strong><small>{total === 1 ? '1 utilizador associado' : `${total} utilizadores associados`}</small></div><div className="item-actions"><button className="btn secondary" onClick={() => onAbrir(a.id, 'equipa')}><Users size={16}/><span>Utilizadores</span></button><button className="btn secondary" onClick={() => onAbrir(a.id, 'inicio')}><ArrowRight size={16}/><span>Abrir</span></button></div></article>
            })}</div>}
        </section>
        <section className="list-panel">
          <div className="list-toolbar"><h2>Contas registadas</h2><span className="list-count">{utilizadores.length}</span></div>
          <div className="items-list">{utilizadores.map(u => {
            const deste = membros.filter(m => m.utilizador_id === u.id).map(m => nomeArmazem.get(m.armazem_id)).filter(Boolean)
            return <article className="item-row" key={u.id}><span className="item-icon"><Users size={20}/></span><div className="item-main"><div className="item-title"><strong>{u.email || 'Sem email'}</strong>{u.id === utilizadorId && <span className="small-badge green">Tu</span>}{u.admin_geral && <span className="role-badge role-administrador">Administrador geral</span>}</div><small>{u.admin_geral ? 'Acesso a todos os armazéns' : deste.length ? deste.join(' · ') : 'Sem armazém associado'}</small></div><div className="item-actions"><button className="btn secondary" disabled={ocupado} onClick={() => { void alterarAdminGeral(u) }}><ShieldCheck size={16}/><span>{u.admin_geral ? 'Retirar admin. geral' : 'Tornar admin. geral'}</span></button></div></article>
          })}</div>
        </section>
      </div>
    </div>
  </>
}
