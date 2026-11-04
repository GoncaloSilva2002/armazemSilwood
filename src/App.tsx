import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import {
  ArrowDownToLine, ArrowRight, ArrowRightLeft, ArrowUpFromLine, Barcode, Boxes,
  Camera, CheckCircle2, ClipboardCheck, Edit3, Info, LayoutDashboard, LogOut,
  MapPin, Menu, Package, Plus, Printer, RefreshCcw, ScanLine, Search,
  ShieldCheck, Tag, Warehouse, X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { configurado, supabase } from './lib/supabase'
import type { Armazem, Localizacao, Produto, ProdutoFormulario } from './lib/types'
import BarcodeScanner from './components/BarcodeScanner'
import Etiqueta from './components/Etiqueta'

type Pagina = 'inicio' | 'produtos' | 'localizacoes' | 'leitor' | 'stock' | 'inventarios'
type Selecionada = { codigo: string; nome: string; categoria: 'Produto' | 'Localização' }

const menu: { id: Pagina; texto: string; icon: LucideIcon; fase?: boolean }[] = [
  { id: 'inicio', texto: 'Painel inicial', icon: LayoutDashboard },
  { id: 'produtos', texto: 'Produtos', icon: Package },
  { id: 'localizacoes', texto: 'Localizações', icon: MapPin },
  { id: 'leitor', texto: 'Ler códigos', icon: ScanLine },
  { id: 'stock', texto: 'Entradas e saídas', icon: ArrowRightLeft, fase: true },
  { id: 'inventarios', texto: 'Inventários', icon: ClipboardCheck, fase: true }
]

const formularioVazio: ProdutoFormulario = {
  nome: '', descricao: '', unidade: 'un', stock_minimo: 0, ativo: true
}

function TextoConfiguracao() {
  return (
    <div className="full-page">
      <div className="auth-card setup-card">
        <div className="brand-mark"><Warehouse size={29} /></div>
        <span className="eyebrow">PRIMEIRA INSTALAÇÃO</span>
        <h1>Configurar o Supabase</h1>
        <p>Os ficheiros da aplicação estão prontos. Para guardar produtos numa base de dados, precisas de associar o teu projeto Supabase.</p>
        <ol className="setup-steps">
          <li>Cria um projeto em <strong>supabase.com</strong>.</li>
          <li>Executa <code>supabase/migrations/001_init.sql</code> no <strong>SQL Editor</strong>.</li>
          <li>Copia <code>.env.example</code> para <code>.env.local</code> e preenche o URL e a <strong>publishable key</strong>.</li>
          <li>Reinicia o servidor de desenvolvimento com <code>npm run dev</code>.</li>
        </ol>
        <p className="notice"><ShieldCheck size={18}/> Nunca uses a chave <code>service_role</code> ou uma secret key no navegador.</p>
      </div>
    </div>
  )
}

function Autenticacao() {
  const [registo, setRegisto] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [mensagem, setMensagem] = useState('')

  async function autenticar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setOcupado(true)
    setMensagem('')
    try {
      const resultado = registo
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (resultado.error) throw resultado.error
      if (registo && !resultado.data.session) {
        setMensagem('Conta criada. Verifica o teu email para confirmar o registo e depois inicia sessão.')
      }
    } catch (erro) {
      setMensagem(erro instanceof Error ? erro.message : 'Não foi possível autenticar.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="full-page">
      <div className="auth-card">
        <div className="brand-mark"><Warehouse size={29} /></div>
        <span className="eyebrow">GESTÃO DE ARMAZÉM</span>
        <h1>{registo ? 'Criar conta' : 'Bem-vindo de volta'}</h1>
        <p>{registo ? 'Cria uma conta para guardar o teu armazém em segurança.' : 'Entra na tua conta para gerir os produtos e etiquetas.'}</p>
        <form onSubmit={autenticar} className="form-stack">
          <label>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="teu@email.pt" required autoComplete="email"/></label>
          <label>Palavra-passe<input type="password" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required autoComplete={registo ? 'new-password' : 'current-password'} placeholder="Pelo menos 6 caracteres" /></label>
          {mensagem && <p className="feedback info">{mensagem}</p>}
          <button className="btn primary full" disabled={ocupado} type="submit">{ocupado ? 'A processar…' : registo ? 'Criar conta' : 'Entrar'} <ArrowRight size={17}/></button>
        </form>
        <p className="switch-auth">{registo ? 'Já tens conta?' : 'Ainda não tens conta?'} <button className="link-btn" type="button" onClick={() => { setRegisto(!registo); setMensagem('') }}>{registo ? 'Iniciar sessão' : 'Criar conta'}</button></p>
      </div>
    </div>
  )
}

function ProdutoModal({ inicial, onClose, onSave, ocupado }: {
  inicial: Produto | null
  onClose: () => void
  onSave: (form: ProdutoFormulario, id?: string) => Promise<void>
  ocupado: boolean
}) {
  const [form, setForm] = useState<ProdutoFormulario>(inicial
    ? { nome: inicial.nome, descricao: inicial.descricao, unidade: inicial.unidade, stock_minimo: inicial.stock_minimo, ativo: inicial.ativo }
    : formularioVazio)
  const [erro, setErro] = useState('')

  async function submeter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (form.nome.trim().length < 2) return setErro('O nome precisa de pelo menos 2 caracteres.')
    if (!Number.isInteger(form.stock_minimo) || form.stock_minimo < 0) return setErro('O stock mínimo deve ser um número inteiro não negativo.')
    setErro('')
    try {
      await onSave({ ...form, nome: form.nome.trim(), descricao: form.descricao.trim() }, inicial?.id)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao guardar o produto.')
    }
  }
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-label={inicial ? 'Editar produto' : 'Adicionar produto'}>
        <div className="modal-head"><div><h2>{inicial ? 'Editar produto' : 'Novo produto'}</h2><p>O código de barras e o QR Code serão criados automaticamente.</p></div><button className="icon-btn" onClick={onClose} aria-label="Fechar"><X size={19}/></button></div>
        <form className="form-stack" onSubmit={submeter}>
          {inicial && <div className="code-inline"><Barcode size={16}/> <strong>{inicial.codigo}</strong> <small>Código permanente</small></div>}
          <label>Nome do produto *<input autoFocus required maxLength={160} minLength={2} value={form.nome} onChange={e => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Caixa de parafusos M8"/></label>
          <label>Descrição<textarea maxLength={2000} rows={3} value={form.descricao} onChange={e => setForm({ ...form, descricao: e.target.value })} placeholder="Detalhes opcionais" /></label>
          <div className="form-row">
            <label>Unidade<select value={form.unidade} onChange={e => setForm({ ...form, unidade: e.target.value })}><option value="un">Unidade</option><option value="cx">Caixa</option><option value="kg">Quilograma</option><option value="m">Metro</option><option value="l">Litro</option></select></label>
            <label>Stock mínimo (referência)<input type="number" min="0" max="999999999" step="1" value={form.stock_minimo} onChange={e => setForm({ ...form, stock_minimo: Number(e.target.value) })}/></label>
          </div>
          {inicial && <label className="checkline"><input type="checkbox" checked={form.ativo} onChange={e => setForm({ ...form, ativo: e.target.checked })}/> Produto ativo no catálogo</label>}
          {erro && <p className="feedback error">{erro}</p>}
          <div className="modal-actions"><button type="button" className="btn ghost" onClick={onClose}>Cancelar</button><button type="submit" className="btn primary" disabled={ocupado}>{ocupado ? 'A guardar…' : inicial ? 'Guardar alterações' : 'Criar produto'}</button></div>
        </form>
      </section>
    </div>
  )
}

function Painel({ produtos, localizacoes, navegar }: { produtos: Produto[]; localizacoes: Localizacao[]; navegar: (pagina: Pagina) => void }) {
  return <>
    <div className="page-intro"><span className="eyebrow">VISÃO GERAL</span><h1>O teu armazém, organizado.</h1><p>Controla o catálogo e identifica cada artigo com um código próprio.</p></div>
    <div className="stat-grid">
      <div className="stat-card"><span><Package size={19}/> Produtos registados</span><strong>{produtos.length}</strong><small>{produtos.filter(p => p.ativo).length} ativos</small></div>
      <div className="stat-card"><span><MapPin size={19}/> Localizações</span><strong>{localizacoes.length}</strong><small>Identificadas por QR e barras</small></div>
      <div className="stat-card muted-stat"><span><Boxes size={19}/> Quantidades</span><strong>—</strong><small>Disponível na fase de movimentos</small></div>
    </div>
    <h2 className="section-title">Acesso rápido</h2>
    <div className="quick-grid">
      <button className="quick-card" onClick={() => navegar('produtos')}><span className="quick-icon"><Plus size={22}/></span><strong>Criar produto</strong><p>Gerar um novo código e etiqueta</p><ArrowRight size={18}/></button>
      <button className="quick-card" onClick={() => navegar('leitor')}><span className="quick-icon"><ScanLine size={22}/></span><strong>Ler um código</strong><p>Telemóvel ou leitor USB/Bluetooth</p><ArrowRight size={18}/></button>
      <button className="quick-card" onClick={() => navegar('localizacoes')}><span className="quick-icon"><MapPin size={22}/></span><strong>Criar localização</strong><p>Identificar estantes e prateleiras</p><ArrowRight size={18}/></button>
    </div>
    <div className="helper-box"><Info size={20}/><p><strong>Fase 1 ativa.</strong> Já podes registar artigos, criar localizações e imprimir etiquetas. Quantidades, entradas, saídas e inventários serão implementados no módulo seguinte.</p></div>
  </>
}

function Dashboard({ session }: { session: Session }) {
  const [pagina, setPagina] = useState<Pagina>('inicio')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [armazem, setArmazem] = useState<Armazem | null>(null)
  const [produtos, setProdutos] = useState<Produto[]>([])
  const [localizacoes, setLocalizacoes] = useState<Localizacao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [busca, setBusca] = useState('')
  const [edicao, setEdicao] = useState<Produto | null | undefined>(undefined)
  const [etiqueta, setEtiqueta] = useState<Selecionada | null>(null)
  const [novaLocalizacao, setNovaLocalizacao] = useState('')
  const [editaLocal, setEditaLocal] = useState<Localizacao | null>(null)
  const [codigoDigitado, setCodigoDigitado] = useState('')
  const [codigoLido, setCodigoLido] = useState('')
  const [cameraAberta, setCameraAberta] = useState(false)
  const leitorInput = useRef<HTMLInputElement>(null)

  const carregarListas = useCallback(async (id: string) => {
    if (!supabase) return
    const [p, l] = await Promise.all([
      supabase.from('produtos').select('id, armazem_id, codigo, nome, descricao, unidade, stock_minimo, ativo, criado_em').eq('armazem_id', id).order('criado_em', { ascending: false }).limit(1000),
      supabase.from('localizacoes').select('id, armazem_id, codigo, nome, criado_em').eq('armazem_id', id).order('criado_em', { ascending: false }).limit(1000)
    ])
    if (p.error) throw p.error
    if (l.error) throw l.error
    setProdutos((p.data || []) as Produto[])
    setLocalizacoes((l.data || []) as Localizacao[])
  }, [])

  const inicializar = useCallback(async () => {
    if (!supabase) return
    setCarregando(true)
    setErro('')
    try {
      const { data, error } = await supabase.from('armazens').select('id, utilizador_id, nome, criado_em').maybeSingle()
      if (error) throw error
      let armazemAtivo = data as Armazem | null
      if (!armazemAtivo) {
        const criado = await supabase.from('armazens').insert({ nome: 'Armazém principal' }).select('id, utilizador_id, nome, criado_em').single()
        if (criado.error) {
          // Evita falha na montagem dupla do React em desenvolvimento.
          const existente = await supabase.from('armazens').select('id, utilizador_id, nome, criado_em').maybeSingle()
          if (existente.error || !existente.data) throw criado.error
          armazemAtivo = existente.data as Armazem
        } else armazemAtivo = criado.data as Armazem
      }
      setArmazem(armazemAtivo)
      await carregarListas(armazemAtivo.id)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao carregar o armazém.')
    } finally {
      setCarregando(false)
    }
  }, [carregarListas])

  useEffect(() => { void inicializar() }, [inicializar, session.user.id])
  useEffect(() => { if (pagina === 'leitor' && !cameraAberta) leitorInput.current?.focus() }, [pagina, cameraAberta])

  function navegar(p: Pagina) { setPagina(p); setMobileMenu(false); setAviso(''); setErro(''); setCameraAberta(false) }

  async function guardarProduto(form: ProdutoFormulario, id?: string) {
    if (!supabase || !armazem) return
    setOcupado(true); setErro('')
    try {
      const resultado = id
        ? await supabase.from('produtos').update(form).eq('id', id).eq('armazem_id', armazem.id)
        : await supabase.from('produtos').insert({ armazem_id: armazem.id, ...form })
      if (resultado.error) throw resultado.error
      await carregarListas(armazem.id)
      setEdicao(undefined)
      setAviso(id ? 'Produto atualizado com sucesso.' : 'Produto criado. O código de barras e o QR Code já estão disponíveis para impressão.')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível guardar o produto.')
      throw e
    } finally { setOcupado(false) }
  }

  async function guardarLocalizacao(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !armazem) return
    const nome = novaLocalizacao.trim()
    if (nome.length < 2) return setErro('Introduz um nome de localização com pelo menos 2 caracteres.')
    setOcupado(true); setErro('')
    try {
      const resultado = editaLocal
        ? await supabase.from('localizacoes').update({ nome }).eq('armazem_id', armazem.id).eq('id', editaLocal.id)
        : await supabase.from('localizacoes').insert({ armazem_id: armazem.id, nome })
      if (resultado.error) throw resultado.error
      await carregarListas(armazem.id)
      setNovaLocalizacao(''); setEditaLocal(null)
      setAviso(editaLocal ? 'Localização atualizada.' : 'Localização criada com o seu código exclusivo.')
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao guardar localização.') }
    finally { setOcupado(false) }
  }

  const produtosFiltrados = useMemo(() => produtos.filter(p =>
    `${p.nome} ${p.codigo} ${p.descricao}`.toLocaleLowerCase('pt-PT').includes(busca.toLocaleLowerCase('pt-PT').trim())
  ), [produtos, busca])
  const codigoNormalizado = codigoLido.trim().toUpperCase()
  const produtoEncontrado = produtos.find(p => p.codigo === codigoNormalizado)
  const localEncontrada = localizacoes.find(l => l.codigo === codigoNormalizado)

  function processarCodigo(codigo: string) {
    const limpo = codigo.trim()
    if (!limpo) return
    setCameraAberta(false)
    setCodigoLido(limpo)
    setCodigoDigitado('')
    setPagina('leitor')
  }

  function abrirEtiqueta(codigo: string, nome: string, categoria: Selecionada['categoria']) {
    setEtiqueta({ codigo, nome, categoria })
  }

  const tituloPagina = menu.find(item => item.id === pagina)?.texto || 'Armazém'

  return <div className="app-shell">
    <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
      <div className="side-brand"><span className="side-brand-icon"><Warehouse size={24}/></span><div><strong>ARMAZÉM</strong><small>Gestão inteligente</small></div><button className="icon-btn mobile-only" onClick={() => setMobileMenu(false)}><X size={19}/></button></div>
      <div className="side-label">ESPAÇO DE TRABALHO</div>
      <nav className="side-nav" aria-label="Navegação principal">{menu.map(item => <button key={item.id} type="button" className={`side-link ${pagina === item.id ? 'active' : ''}`} onClick={() => navegar(item.id)}><item.icon size={19}/><span>{item.texto}</span>{item.fase && <span className="phase-dot" title="Próxima fase"/>}</button>)}</nav>
      <div className="side-bottom"><span className="side-label">CONTA</span><div className="account-chip"><span className="account-avatar">{(session.user.email || '?')[0].toUpperCase()}</span><div><strong>{session.user.email || 'Utilizador'}</strong><small>Responsável pelo armazém</small></div></div><button className="logout-btn" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={17}/> Terminar sessão</button></div>
    </aside>
    {mobileMenu && <div className="mobile-overlay" onClick={() => setMobileMenu(false)}/>}
    <main className="main-content">
      <header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-only" aria-label="Abrir menu" onClick={() => setMobileMenu(true)}><Menu size={23}/></button><span className="topbar-breadcrumb">Armazém <span>/</span> <strong>{tituloPagina}</strong></span></div><span className="sync-pill"><CheckCircle2 size={15}/> Ligado ao Supabase</span></header>
      <div className="content-container">
        {erro && <div className="feedback error global-msg"><Info size={18}/><span>{erro}</span><button aria-label="Fechar erro" onClick={() => setErro('')}><X size={16}/></button></div>}
        {aviso && <div className="feedback success global-msg"><CheckCircle2 size={18}/><span>{aviso}</span><button aria-label="Fechar aviso" onClick={() => setAviso('')}><X size={16}/></button></div>}
        {carregando ? <div className="loading-panel">A carregar os dados do armazém…</div> : !armazem ? <div className="empty-panel"><h2>Não foi possível abrir o armazém</h2><button className="btn primary" onClick={() => { void inicializar() }}><RefreshCcw size={16}/> Tentar novamente</button></div> : <>
          {pagina === 'inicio' && <Painel produtos={produtos} localizacoes={localizacoes} navegar={navegar}/>}
          {pagina === 'produtos' && <>
            <div className="page-header"><div><span className="eyebrow">CATÁLOGO</span><h1>Produtos</h1><p>Cria artigos e gera automaticamente os respetivos códigos.</p></div><button className="btn primary" onClick={() => setEdicao(null)}><Plus size={18}/> Novo produto</button></div>
            <div className="list-panel"><div className="list-toolbar"><label className="search-bar"><Search size={18}/><input placeholder="Pesquisar por nome ou código…" value={busca} onChange={e => setBusca(e.target.value)}/></label><span className="list-count">{produtosFiltrados.length} produtos</span></div>
              {produtosFiltrados.length === 0 ? <div className="empty-state"><Package size={30}/><h3>{busca ? 'Nenhum resultado' : 'Ainda não tens produtos'}</h3><p>{busca ? 'Experimenta pesquisar por outro nome ou código.' : 'Cria o primeiro artigo e imprime a tua etiqueta.'}</p>{!busca && <button className="btn primary" onClick={() => setEdicao(null)}><Plus size={17}/> Criar produto</button>}</div> :
                <div className="items-list">{produtosFiltrados.map(p => <article className="item-row" key={p.id}><span className="item-icon"><Package size={21}/></span><div className="item-main"><div className="item-title"><strong>{p.nome}</strong>{!p.ativo && <span className="small-badge">Inativo</span>}</div><span className="code-tag"><Barcode size={14}/>{p.codigo}</span><small>{p.unidade} · Stock mínimo de referência: {p.stock_minimo}</small></div><div className="item-actions"><button className="btn secondary" onClick={() => abrirEtiqueta(p.codigo, p.nome, 'Produto')}><Printer size={16}/><span>Etiqueta</span></button><button className="btn secondary" onClick={() => setEdicao(p)}><Edit3 size={16}/><span>Editar</span></button></div></article>)}</div>}
            </div><p className="micro footnote">A lista apresenta até 1.000 produtos nesta versão. O stock físico só será calculado quando implementarmos os movimentos.</p>
          </>}
          {pagina === 'localizacoes' && <>
            <div className="page-header"><div><span className="eyebrow">ORGANIZAÇÃO</span><h1>Localizações</h1><p>Cria identificadores para estantes, prateleiras, corredores ou caixas.</p></div></div>
            <div className="location-grid"><section className="list-panel creation-panel"><h2>{editaLocal ? 'Editar localização' : 'Nova localização'}</h2><p>Exemplo: Corredor A · Estante 03 · Prateleira 02.</p><form onSubmit={guardarLocalizacao} className="form-stack"><label>Nome / descrição<input required minLength={2} maxLength={120} placeholder="Ex.: A-03-02" value={novaLocalizacao} onChange={e => setNovaLocalizacao(e.target.value)}/></label><button className="btn primary full" disabled={ocupado} type="submit">{ocupado ? 'A guardar…' : editaLocal ? 'Guardar localização' : 'Criar localização'} <Plus size={17}/></button>{editaLocal && <button className="btn ghost full" type="button" onClick={() => { setEditaLocal(null); setNovaLocalizacao('') }}>Cancelar edição</button>}</form></section>
              <section className="list-panel"><div className="list-toolbar"><h2>Localizações criadas</h2><span className="list-count">{localizacoes.length}</span></div>{!localizacoes.length ? <div className="empty-state compact"><MapPin size={29}/><h3>Sem localizações</h3><p>Cria uma localização para começar.</p></div> : <div className="items-list">{localizacoes.map(l => <article key={l.id} className="item-row"><span className="item-icon"><MapPin size={20}/></span><div className="item-main"><strong>{l.nome}</strong><span className="code-tag"><Barcode size={14}/>{l.codigo}</span></div><div className="item-actions"><button className="btn secondary" onClick={() => abrirEtiqueta(l.codigo, l.nome, 'Localização')} title="Imprimir etiqueta"><Printer size={16}/><span>Etiqueta</span></button><button className="btn secondary" title="Editar" onClick={() => { setEditaLocal(l); setNovaLocalizacao(l.nome) }}><Edit3 size={16}/></button></div></article>)}</div>}</section></div>
          </>}
          {pagina === 'leitor' && <>
            <div className="page-header"><div><span className="eyebrow">IDENTIFICAÇÃO</span><h1>Leitura de códigos</h1><p>Usa a câmara ou um leitor USB/Bluetooth configurado em modo teclado (HID).</p></div></div>
            <section className="scan-panel"><div className="scan-head"><div className="scan-head-icon"><ScanLine size={26}/></div><div><h2>Identificar produto ou localização</h2><p>Lê um QR Code ou um código de barras Code 128.</p></div></div>
              <form className="scan-form" onSubmit={e => { e.preventDefault(); processarCodigo(codigoDigitado) }}><label className="scan-input-wrap"><Barcode size={19}/><input ref={leitorInput} aria-label="Código a identificar" value={codigoDigitado} onChange={e => setCodigoDigitado(e.target.value)} placeholder="Lê um código ou escreve ARM-00000001" autoComplete="off" /></label><button className="btn primary" type="submit">Procurar <ArrowRight size={17}/></button></form>
              <div className="scan-divider"><span>ou</span></div><button className="btn outline scan-camera-button" type="button" onClick={() => setCameraAberta(value => !value)}><Camera size={19}/>{cameraAberta ? 'Fechar câmara' : 'Ler com câmara do telemóvel'}</button>
              {cameraAberta && <BarcodeScanner onRead={processarCodigo} onClose={() => setCameraAberta(false)} />}
              {codigoLido && <div className="scan-result"><span className="eyebrow">RESULTADO DA LEITURA</span><span className="result-code">{codigoLido}</span>{produtoEncontrado ? <div className="found-card"><div><span className="small-badge green">Produto identificado</span><h3>{produtoEncontrado.nome}</h3><p>{produtoEncontrado.descricao || 'Sem descrição'} · {produtoEncontrado.unidade}</p></div><button className="btn secondary" onClick={() => abrirEtiqueta(produtoEncontrado.codigo, produtoEncontrado.nome, 'Produto')}><Tag size={17}/> Etiqueta</button></div> : localEncontrada ? <div className="found-card"><div><span className="small-badge green">Localização identificada</span><h3>{localEncontrada.nome}</h3><p>Localização do armazém</p></div><button className="btn secondary" onClick={() => abrirEtiqueta(localEncontrada.codigo, localEncontrada.nome, 'Localização')}><Tag size={17}/> Etiqueta</button></div> : <div className="unknown-card"><Info size={20}/><p>Este código ainda não está registado neste armazém. Os códigos internos são criados automaticamente ao adicionar produtos e localizações.</p></div>}</div>}
              <p className="micro scan-tip">Dica: os leitores tipo teclado normalmente introduzem o código e enviam Enter. Mantém o campo de pesquisa selecionado.</p>
            </section>
          </>}
          {pagina === 'stock' && <>
            <div className="page-header"><div><span className="eyebrow">PRÓXIMA ETAPA</span><h1>Entradas e saídas</h1><p>As tabelas de stock e movimentos já estão preparadas na base de dados.</p></div></div><div className="future-panel"><span className="future-icon"><ArrowRightLeft size={32}/></span><h2>Movimentos na fase 2</h2><p>Vamos adicionar entradas, saídas, transferências entre localizações e histórico. Os movimentos serão executados por operações SQL transacionais, com validação de saldo e registo do utilizador.</p><div className="future-row"><span><ArrowDownToLine size={18}/> Entradas</span><span><ArrowUpFromLine size={18}/> Saídas</span><span><ArrowRightLeft size={18}/> Transferências</span></div><button className="btn secondary" onClick={() => navegar('produtos')}>Voltar aos produtos</button></div>
          </>}
          {pagina === 'inventarios' && <>
            <div className="page-header"><div><span className="eyebrow">PRÓXIMA ETAPA</span><h1>Inventários</h1><p>As tabelas de sessões de inventário e contagens já estão criadas.</p></div></div><div className="future-panel"><span className="future-icon"><ClipboardCheck size={32}/></span><h2>Contagem física na fase 3</h2><p>Vamos poder abrir um inventário, ler a etiqueta de cada artigo e localização, contar as unidades e comparar com os saldos. Os ajustes exigirão confirmação.</p><button className="btn secondary" onClick={() => navegar('leitor')}>Testar leitura de códigos</button></div>
          </>}
        </>}
      </div>
    </main>
    {edicao !== undefined && <ProdutoModal inicial={edicao} onClose={() => setEdicao(undefined)} onSave={guardarProduto} ocupado={ocupado}/>}
    {etiqueta && <Etiqueta {...etiqueta} onClose={() => setEtiqueta(null)}/>}
  </div>
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [aCarregar, setACarregar] = useState(true)
  useEffect(() => {
    if (!supabase) { setACarregar(false); return }
    const client = supabase
    let ativo = true
    void client.auth.getSession().then(({ data: { session } }) => {
      if (ativo) { setSession(session); setACarregar(false) }
    }).catch(() => { if (ativo) setACarregar(false) })
    const { data: { subscription } } = client.auth.onAuthStateChange((_evento, novaSessao) => {
      if (ativo) { setSession(novaSessao); setACarregar(false) }
    })
    return () => { ativo = false; subscription.unsubscribe() }
  }, [])

  if (!configurado) return <TextoConfiguracao />
  if (aCarregar) return <div className="full-page"><div className="initial-loading"><Warehouse size={28}/> A iniciar o armazém…</div></div>
  if (!session) return <Autenticacao />
  return <Dashboard key={session.user.id} session={session} />
}
