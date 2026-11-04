import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { CheckCircle2, Info, Link2, LogOut, Mail, Save, Trash2, UserPlus, Users, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { listaPapeis, papeis } from '../lib/permissoes'
import type { ArmazemAcesso, ConviteEnviado, ConviteRecebido, Membro, Papel, UtilizadorRegistado } from '../lib/types'

type Cliente = NonNullable<typeof supabase>
type Resultado = PromiseLike<{ error: { message: string } | null }>

export function ConvitesRecebidos({ convites, ocupado, onResponder }: {
  convites: ConviteRecebido[]
  ocupado: boolean
  onResponder: (convite: ConviteRecebido, aceitar: boolean) => void
}) {
  return (
    <section className="invite-panel">
      <div className="invite-head"><Mail size={20}/><div><strong>{convites.length === 1 ? 'Tens um convite pendente' : `Tens ${convites.length} convites pendentes`}</strong><small>Ao aceitar, o armazém fica disponível no menu lateral.</small></div></div>
      {convites.map(c => <div className="invite-row" key={c.id}><div><strong>{c.armazem_nome}</strong><span className={`role-badge role-${c.papel}`}>{papeis[c.papel].nome}</span></div><div className="item-actions"><button className="btn ghost" disabled={ocupado} onClick={() => onResponder(c, false)}>Recusar</button><button className="btn primary" disabled={ocupado} onClick={() => onResponder(c, true)}>Aceitar</button></div></div>)}
    </section>
  )
}

export default function Equipa({ armazem, utilizadorId, adminGeral, onAlterado }: {
  armazem: ArmazemAcesso
  utilizadorId: string
  adminGeral: boolean
  onAlterado: () => void
}) {
  const eAdmin = armazem.papel === 'administrador'
  const [membros, setMembros] = useState<Membro[]>([])
  const [convites, setConvites] = useState<ConviteEnviado[]>([])
  const [registados, setRegistados] = useState<UtilizadorRegistado[]>([])
  const [nome, setNome] = useState(armazem.nome)
  const [email, setEmail] = useState('')
  const [papel, setPapel] = useState<Papel>('operador')
  const [associar, setAssociar] = useState('')
  const [papelAssociar, setPapelAssociar] = useState<Papel>('operador')
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  const carregar = useCallback(async () => {
    if (!supabase) return
    try {
      const m = await supabase.from('membros_armazem').select('armazem_id, utilizador_id, email, papel, criado_em').eq('armazem_id', armazem.id).order('criado_em')
      if (m.error) throw m.error
      setMembros((m.data || []) as Membro[])
      if (!eAdmin) return setConvites([])
      const c = await supabase.from('convites_armazem').select('id, armazem_id, email, papel, criado_em').eq('armazem_id', armazem.id).order('criado_em', { ascending: false })
      if (c.error) throw c.error
      setConvites((c.data || []) as ConviteEnviado[])
      if (!adminGeral) return
      const u = await supabase.rpc('listar_utilizadores')
      if (u.error) throw u.error
      setRegistados((u.data || []) as UtilizadorRegistado[])
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os utilizadores.')
    }
  }, [armazem.id, eAdmin, adminGeral])

  useEffect(() => { void carregar() }, [carregar])
  useEffect(() => { setNome(armazem.nome) }, [armazem.nome])

  async function executar(acao: (db: Cliente) => Resultado, sucesso: string) {
    if (!supabase) return false
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { error } = await acao(supabase)
      if (error) throw new Error(error.message)
      await carregar()
      setAviso(sucesso)
      return true
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível concluir a operação.')
      return false
    } finally { setOcupado(false) }
  }

  async function renomear(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const limpo = nome.trim()
    if (limpo.length < 2) return setErro('O nome do armazém precisa de pelo menos 2 caracteres.')
    if (await executar(db => db.from('armazens').update({ nome: limpo }).eq('id', armazem.id), 'Nome do armazém atualizado.')) onAlterado()
  }

  async function associarUtilizador(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const escolhido = registados.find(u => u.id === associar)
    if (!escolhido) return setErro('Escolhe um utilizador.')
    if (await executar(db => db.rpc('associar_utilizador', { p_armazem: armazem.id, p_utilizador: escolhido.id, p_papel: papelAssociar }), `${escolhido.email} associado como ${papeis[papelAssociar].nome}.`)) {
      setAssociar('')
      if (escolhido.id === utilizadorId) onAlterado()
    }
  }

  async function convidar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const limpo = email.trim().toLowerCase()
    if (await executar(db => db.rpc('convidar_membro', { p_armazem: armazem.id, p_email: limpo, p_papel: papel }), `Convite enviado para ${limpo}. A pessoa vê-o quando entrar na app com este email.`)) setEmail('')
  }

  async function alterarPapel(membro: Membro, novo: Papel) {
    const eu = membro.utilizador_id === utilizadorId
    if (eu && novo !== 'administrador' && !window.confirm('Vais deixar de ser administrador deste armazém e perder acesso a esta gestão. Continuar?')) return
    if (await executar(db => db.rpc('alterar_papel_membro', { p_armazem: armazem.id, p_utilizador: membro.utilizador_id, p_papel: novo }), `Permissão de ${membro.email} alterada para ${papeis[novo].nome}.`) && eu) onAlterado()
  }

  async function remover(membro: Membro) {
    const eu = membro.utilizador_id === utilizadorId
    if (!window.confirm(eu ? `Sair do armazém «${armazem.nome}»? Deixas de ter acesso aos seus dados.` : `Remover o acesso de ${membro.email} a este armazém?`)) return
    if (await executar(db => db.rpc('remover_membro', { p_armazem: armazem.id, p_utilizador: membro.utilizador_id }), eu ? 'Saíste do armazém.' : 'Acesso removido.') && eu) onAlterado()
  }

  function cancelarConvite(convite: ConviteEnviado) {
    void executar(db => db.rpc('cancelar_convite', { p_convite: convite.id }), `Convite para ${convite.email} cancelado.`)
  }

  const porAssociar = registados.filter(u => !membros.some(m => m.utilizador_id === u.id))

  return <>
    <div className="page-header"><div><span className="eyebrow">EQUIPA · {armazem.nome.toLocaleUpperCase('pt-PT')}</span><h1>Utilizadores e permissões</h1><p>{eAdmin ? 'Convida pessoas para este armazém e define o que cada uma pode fazer.' : 'Pessoas com acesso a este armazém. Só os administradores podem alterar permissões.'}</p></div></div>
    {erro && <div className="feedback error global-msg"><Info size={18}/><span>{erro}</span><button aria-label="Fechar erro" onClick={() => setErro('')}><X size={16}/></button></div>}
    {aviso && <div className="feedback success global-msg"><CheckCircle2 size={18}/><span>{aviso}</span><button aria-label="Fechar aviso" onClick={() => setAviso('')}><X size={16}/></button></div>}
    <div className="location-grid">
      <section className="list-panel creation-panel">
        {eAdmin ? <>
          {adminGeral && <>
            <h2>Associar utilizador</h2><p>Escolhe uma conta já registada na app. Fica logo com acesso a este armazém.</p>
            <form className="form-stack" onSubmit={associarUtilizador}>
              <label>Utilizador<select required value={associar} onChange={e => setAssociar(e.target.value)}><option value="">{porAssociar.length ? 'Escolher…' : 'Todas as contas já estão associadas'}</option>{porAssociar.map(u => <option key={u.id} value={u.id}>{u.email || 'Sem email'}</option>)}</select></label>
              <label>Permissão<select value={papelAssociar} onChange={e => setPapelAssociar(e.target.value as Papel)}>{listaPapeis.map(p => <option key={p} value={p}>{papeis[p].nome}</option>)}</select></label>
              <button className="btn primary full" disabled={ocupado || !associar} type="submit"><Link2 size={17}/> Associar ao armazém</button>
            </form>
            <div className="form-divider"/>
          </>}
          <h2>{adminGeral ? 'Convidar por email' : 'Convidar utilizador'}</h2><p>{adminGeral ? 'Para quem ainda não tem conta. ' : ''}A pessoa tem de criar conta (ou entrar) com este email, já confirmado, para ver o convite.</p>
          <form className="form-stack" onSubmit={convidar}>
            <label>Email<input type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} placeholder="colega@empresa.pt" autoComplete="off"/></label>
            <label>Permissão<select value={papel} onChange={e => setPapel(e.target.value as Papel)}>{listaPapeis.map(p => <option key={p} value={p}>{papeis[p].nome}</option>)}</select></label>
            <button className={`btn ${adminGeral ? 'secondary' : 'primary'} full`} disabled={ocupado} type="submit"><UserPlus size={17}/> Enviar convite</button>
          </form>
          <div className="form-divider"/>
          <h2>Nome do armazém</h2>
          <form className="form-stack" onSubmit={renomear}>
            <label>Nome<input required minLength={2} maxLength={120} value={nome} onChange={e => setNome(e.target.value)}/></label>
            <button className="btn secondary full" disabled={ocupado || nome.trim() === armazem.nome} type="submit"><Save size={16}/> Guardar nome</button>
          </form>
        </> : <><h2>A tua permissão</h2><p>Neste armazém és <span className={`role-badge role-${armazem.papel}`}>{papeis[armazem.papel].nome}</span></p></>}
        <div className="roles-legend">{listaPapeis.map(p => <div key={p}><span className={`role-badge role-${p}`}>{papeis[p].nome}</span><small>{papeis[p].descricao}</small></div>)}</div>
      </section>
      <div className="team-column">
        <section className="list-panel">
          <div className="list-toolbar"><h2>Membros</h2><span className="list-count">{membros.length}</span></div>
          <div className="items-list">{membros.map(m => {
            const eu = m.utilizador_id === utilizadorId
            return <article className="item-row" key={m.utilizador_id}>
              <span className="item-icon"><Users size={20}/></span>
              <div className="item-main"><div className="item-title"><strong>{m.email || 'Sem email'}</strong>{eu && <span className="small-badge green">Tu</span>}</div><small>Com acesso desde {new Date(m.criado_em).toLocaleDateString('pt-PT')}</small></div>
              <div className="item-actions">
                {eAdmin
                  ? <select className="role-select" aria-label={`Permissão de ${m.email}`} value={m.papel} disabled={ocupado} onChange={e => { void alterarPapel(m, e.target.value as Papel) }}>{listaPapeis.map(p => <option key={p} value={p}>{papeis[p].nome}</option>)}</select>
                  : <span className={`role-badge role-${m.papel}`}>{papeis[m.papel].nome}</span>}
                {(eAdmin || eu) && <button className="btn secondary" disabled={ocupado} title={eu ? 'Sair do armazém' : 'Remover acesso'} onClick={() => { void remover(m) }}>{eu ? <LogOut size={16}/> : <Trash2 size={16}/>}<span>{eu ? 'Sair' : 'Remover'}</span></button>}
              </div>
            </article>
          })}</div>
        </section>
        {eAdmin && <section className="list-panel">
          <div className="list-toolbar"><h2>Convites pendentes</h2><span className="list-count">{convites.length}</span></div>
          {!convites.length ? <div className="empty-state compact"><Mail size={29}/><h3>Sem convites pendentes</h3><p>Os convites aparecem aqui até a pessoa aceitar ou recusar.</p></div> :
            <div className="items-list">{convites.map(c => <article className="item-row" key={c.id}><span className="item-icon"><Mail size={20}/></span><div className="item-main"><strong>{c.email}</strong><small>Enviado em {new Date(c.criado_em).toLocaleDateString('pt-PT')}</small></div><div className="item-actions"><span className={`role-badge role-${c.papel}`}>{papeis[c.papel].nome}</span><button className="btn secondary" disabled={ocupado} title="Cancelar convite" onClick={() => cancelarConvite(c)}><X size={16}/><span>Cancelar</span></button></div></article>)}</div>}
        </section>}
      </div>
    </div>
  </>
}
