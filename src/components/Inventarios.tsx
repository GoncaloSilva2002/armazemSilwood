import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle, ArrowRight, Ban, Barcode, Camera, CheckCircle2, ClipboardCheck, Download, Info,
  ListChecks, MapPin, Minus, Package, Plus, RefreshCcw, ScanLine, Trash2, X
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { mensagemErro } from '../lib/erros'
import { podeContar, podeValidarInventario } from '../lib/permissoes'
import { lerCodigo } from '../lib/codigos'
import type { ArmazemAcesso, Contagem, Inventario, Localizacao, Produto, StockSaldo } from '../lib/types'
import BarcodeScanner from './BarcodeScanner'
import { qtd } from './Movimentos'

type Separador = 'contar' | 'diferencas'
type Modo = 'picar' | 'quantidade'

type Linha = {
  produto_id: string
  localizacao_id: string
  contada: number
  sistema: number
  diferenca: number
  naoContado: boolean
  contagem?: Contagem
}

const formatoData = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
const formatoDia = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short' })
const inteiro = (unidade: string) => unidade === 'un' || unidade === 'cx'
const sinal = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + qtd(Math.abs(n))
const chave = (produto: string, local: string) => `${produto}:${local}`
const estados = { aberto: 'Aberto', fechado: 'Fechado', cancelado: 'Cancelado' } as const

const colunasInventario = 'id, armazem_id, titulo, estado, localizacao_id, observacao, criado_por_email, criado_em, fechado_em, fechado_por_email, ajustes_aplicados'
const colunasContagem = 'id, inventario_id, produto_id, localizacao_id, quantidade_contada, quantidade_sistema, diferenca, nao_contado, contado_por_email, contado_em'

export default function Inventarios({ armazem, produtos, localizacoes, saldos, onRecarregar }: {
  armazem: ArmazemAcesso
  produtos: Produto[]
  localizacoes: Localizacao[]
  saldos: StockSaldo[]
  onRecarregar: () => Promise<void>
}) {
  const contar = podeContar(armazem.papel)
  const validar = podeValidarInventario(armazem.papel)

  const [inventarios, setInventarios] = useState<Inventario[]>([])
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  const [contagens, setContagens] = useState<Contagem[]>([])
  const [carregando, setCarregando] = useState(true)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')

  // Abrir inventário
  const [titulo, setTitulo] = useState(() => `Inventário ${formatoDia.format(new Date())}`)
  const [ambito, setAmbito] = useState('')
  const [obsAbrir, setObsAbrir] = useState('')

  // Contagem
  const [separador, setSeparador] = useState<Separador>('contar')
  const [modo, setModo] = useState<Modo>('picar')
  const [localId, setLocalId] = useState('')
  const [produtoId, setProdutoId] = useState('')
  const [quantidade, setQuantidade] = useState('')
  const [codigo, setCodigo] = useState('')
  const [camera, setCamera] = useState(false)
  const [zerar, setZerar] = useState(true)
  const [soDiferencas, setSoDiferencas] = useState(true)
  const leitor = useRef<HTMLInputElement>(null)

  const produtoPorId = useMemo(() => new Map(produtos.map(p => [p.id, p])), [produtos])
  const localPorId = useMemo(() => new Map(localizacoes.map(l => [l.id, l])), [localizacoes])
  const nomeLocal = (id: string | null) => (id && localPorId.get(id)?.nome) || '—'
  const selecionado = inventarios.find(i => i.id === selecionadoId) ?? null
  const aberto = inventarios.find(i => i.estado === 'aberto') ?? null
  const emCurso = selecionado?.estado === 'aberto'

  const carregarInventarios = useCallback(async () => {
    if (!supabase) return
    const { data, error } = await supabase.from('inventarios').select(colunasInventario)
      .eq('armazem_id', armazem.id).order('criado_em', { ascending: false }).limit(100)
    if (error) throw error
    const lista = (data || []) as Inventario[]
    setInventarios(lista)
    setSelecionadoId(atual => atual && lista.some(i => i.id === atual) ? atual : (lista.find(i => i.estado === 'aberto')?.id ?? null))
  }, [armazem.id])

  const carregarContagens = useCallback(async (inventarioId: string) => {
    if (!supabase) return
    const { data, error } = await supabase.from('contagens_inventario').select(colunasContagem)
      .eq('inventario_id', inventarioId).order('contado_em', { ascending: false })
    if (error) throw error
    setContagens((data || []) as Contagem[])
  }, [])

  useEffect(() => {
    setCarregando(true)
    carregarInventarios().catch(e => setErro(mensagemErro(e, 'Não foi possível carregar os inventários.'))).finally(() => setCarregando(false))
  }, [carregarInventarios])

  useEffect(() => {
    setContagens([])
    if (!selecionadoId) return
    carregarContagens(selecionadoId).catch(e => setErro(mensagemErro(e, 'Não foi possível carregar as contagens.')))
  }, [selecionadoId, carregarContagens])

  // Inventário de uma só localização: essa localização fica fixa.
  useEffect(() => {
    setLocalId(selecionado?.localizacao_id ?? '')
    setProdutoId(''); setQuantidade(''); setSeparador('contar')
  }, [selecionado?.id, selecionado?.localizacao_id])

  async function atualizarTudo() {
    setErro('')
    try {
      await Promise.all([carregarInventarios(), selecionadoId ? carregarContagens(selecionadoId) : Promise.resolve(), onRecarregar()])
    } catch (e) { setErro(mensagemErro(e, 'Não foi possível atualizar.')) }
  }

  // ------------------------------------------------------------ abrir
  async function abrir(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase) return
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { data, error } = await supabase.rpc('abrir_inventario', {
        p_armazem: armazem.id, p_titulo: titulo.trim(), p_localizacao: ambito || null, p_observacao: obsAbrir.trim()
      })
      if (error) throw error
      setSelecionadoId(data as string)
      await carregarInventarios()
      setObsAbrir('')
      setAviso('Inventário aberto. Lê a etiqueta da localização e depois a de cada artigo.')
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível abrir o inventário.'))
    } finally { setOcupado(false) }
  }

  // ------------------------------------------------------------ contar
  async function gravarContagem(produto: Produto, valor: number, somar: boolean) {
    if (!supabase || !selecionado) return
    if (!localId) { setErro('Lê ou escolhe primeiro a localização que estás a contar.'); return }
    setOcupado(true); setErro('')
    try {
      const { data, error } = await supabase.rpc('registar_contagem', {
        p_inventario: selecionado.id, p_produto: produto.id, p_localizacao: localId, p_quantidade: valor, p_somar: somar
      })
      if (error) throw error
      setAviso(`${produto.nome}: ${qtd(Number(data))} ${produto.unidade} contados em ${nomeLocal(localId)}.`)
      await carregarContagens(selecionado.id)
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível registar a contagem.'))
    } finally {
      setOcupado(false)
      leitor.current?.focus()
    }
  }

  function processarCodigo(lido: string) {
    const { codigo: limpo } = lerCodigo(lido)
    setCamera(false); setCodigo('')
    if (!limpo) return
    setErro(''); setAviso('')
    const l = localizacoes.find(x => x.codigo === limpo)
    if (l) {
      if (selecionado?.localizacao_id && l.id !== selecionado.localizacao_id) {
        setErro(`Este inventário só abrange ${nomeLocal(selecionado.localizacao_id)}.`); return
      }
      setLocalId(l.id); setAviso(`A contar em ${l.nome}.`); return
    }
    const p = produtos.find(x => x.codigo === limpo)
    if (!p) { setErro(`O código ${limpo} não está registado neste armazém.`); return }
    if (modo === 'picar' && inteiro(p.unidade)) { void gravarContagem(p, 1, true); return }
    setModo('quantidade'); setProdutoId(p.id)
    const atual = contagemPorChave.get(chave(p.id, localId))
    setQuantidade(atual ? String(atual.quantidade_contada) : '')
    if (modo === 'picar') setAviso(`${p.nome} é medido em ${p.unidade}: indica a quantidade.`)
  }

  async function guardarQuantidade(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const produto = produtoPorId.get(produtoId)
    if (!produto) return setErro('Escolhe o produto.')
    const valor = Number(quantidade.replace(',', '.'))
    if (!Number.isFinite(valor) || valor < 0) return setErro('Indica uma quantidade igual ou maior que zero.')
    if (inteiro(produto.unidade) && !Number.isInteger(valor)) return setErro('Este produto é contado em unidades inteiras.')
    await gravarContagem(produto, valor, false)
    setProdutoId(''); setQuantidade('')
  }

  async function removerContagem(c: Contagem) {
    if (!supabase || !selecionado) return
    setOcupado(true); setErro('')
    try {
      const { error } = await supabase.rpc('remover_contagem', { p_inventario: selecionado.id, p_produto: c.produto_id, p_localizacao: c.localizacao_id })
      if (error) throw error
      await carregarContagens(selecionado.id)
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível remover a contagem.'))
    } finally { setOcupado(false) }
  }

  async function ajustarUm(c: Contagem, delta: number) {
    const novo = Number(c.quantidade_contada) + delta
    if (!supabase || !selecionado || novo < 0) return
    setOcupado(true); setErro('')
    try {
      const { error } = await supabase.rpc('registar_contagem', { p_inventario: selecionado.id, p_produto: c.produto_id, p_localizacao: c.localizacao_id, p_quantidade: novo, p_somar: false })
      if (error) throw error
      await carregarContagens(selecionado.id)
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível alterar a contagem.'))
    } finally { setOcupado(false) }
  }

  // ------------------------------------------------------------ diferenças
  const contagemPorChave = useMemo(() => new Map(contagens.map(c => [chave(c.produto_id, c.localizacao_id), c])), [contagens])
  const saldoPorChave = useMemo(() => new Map(saldos.map(s => [chave(s.produto_id, s.localizacao_id), Number(s.quantidade)])), [saldos])

  // Para inventários abertos compara com o saldo atual; nos fechados usa o que foi gravado no fecho.
  const linhas = useMemo<Linha[]>(() => {
    if (!selecionado) return []
    if (!emCurso) return contagens.map(c => ({
      produto_id: c.produto_id, localizacao_id: c.localizacao_id, contada: Number(c.quantidade_contada),
      sistema: Number(c.quantidade_sistema ?? 0), diferenca: Number(c.diferenca ?? 0), naoContado: c.nao_contado, contagem: c
    }))
    const resultado: Linha[] = contagens.map(c => {
      const sistema = saldoPorChave.get(chave(c.produto_id, c.localizacao_id)) ?? 0
      return { produto_id: c.produto_id, localizacao_id: c.localizacao_id, contada: Number(c.quantidade_contada), sistema, diferenca: Number(c.quantidade_contada) - sistema, naoContado: false, contagem: c }
    })
    if (zerar) {
      const locaisContados = selecionado.localizacao_id ? new Set([selecionado.localizacao_id]) : new Set(contagens.map(c => c.localizacao_id))
      for (const s of saldos) {
        const q = Number(s.quantidade)
        if (q > 0 && locaisContados.has(s.localizacao_id) && !contagemPorChave.has(chave(s.produto_id, s.localizacao_id))) {
          resultado.push({ produto_id: s.produto_id, localizacao_id: s.localizacao_id, contada: 0, sistema: q, diferenca: -q, naoContado: true })
        }
      }
    }
    return resultado
  }, [selecionado, emCurso, contagens, saldos, saldoPorChave, contagemPorChave, zerar])

  const ordenar = (a: Linha, b: Linha) =>
    nomeLocal(a.localizacao_id).localeCompare(nomeLocal(b.localizacao_id), 'pt-PT') ||
    (produtoPorId.get(a.produto_id)?.nome ?? '').localeCompare(produtoPorId.get(b.produto_id)?.nome ?? '', 'pt-PT')
  const comDiferenca = linhas.filter(l => l.diferenca !== 0)
  const sobras = comDiferenca.filter(l => l.diferenca > 0).length
  const faltas = comDiferenca.filter(l => l.diferenca < 0).length
  const linhasVisiveis = (soDiferencas ? comDiferenca : linhas).slice().sort(ordenar)

  // Na localização atual: o que já foi contado e o que ainda falta contar.
  const contadasAqui = contagens.filter(c => c.localizacao_id === localId)
  const porContarAqui = localId ? saldos.filter(s => s.localizacao_id === localId && Number(s.quantidade) > 0 && !contagemPorChave.has(chave(s.produto_id, localId))) : []
  const locaisContados = new Set(contagens.map(c => c.localizacao_id)).size

  async function fechar() {
    if (!supabase || !selecionado) return
    const msg = comDiferenca.length
      ? `Validar o inventário "${selecionado.titulo}"?\n\nVão ser registados ${comDiferenca.length} ajustes de stock (${sobras} sobras, ${faltas} faltas). Os ajustes ficam no histórico e não podem ser desfeitos.`
      : `Fechar o inventário "${selecionado.titulo}"?\n\nNão há diferenças: o stock não vai ser alterado.`
    if (!window.confirm(msg)) return
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { data, error } = await supabase.rpc('fechar_inventario', { p_inventario: selecionado.id, p_zerar_nao_contados: zerar })
      if (error) throw error
      await Promise.all([carregarInventarios(), carregarContagens(selecionado.id), onRecarregar()])
      setAviso(`Inventário fechado. ${Number(data) ? `${data} ajustes aplicados ao stock.` : 'Sem ajustes ao stock.'}`)
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível fechar o inventário.'))
    } finally { setOcupado(false) }
  }

  async function cancelar() {
    if (!supabase || !selecionado) return
    if (!window.confirm(`Cancelar o inventário "${selecionado.titulo}"?\n\nAs contagens ficam guardadas para consulta, mas o stock não é alterado.`)) return
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { error } = await supabase.rpc('cancelar_inventario', { p_inventario: selecionado.id })
      if (error) throw error
      await carregarInventarios()
      setAviso('Inventário cancelado. O stock não foi alterado.')
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível cancelar o inventário.'))
    } finally { setOcupado(false) }
  }

  function exportarCsv() {
    if (!selecionado) return
    const esc = (v: string | number) => `"${String(v).replaceAll('"', '""')}"`
    const num = (n: number) => String(n).replace('.', ',')
    const cab = ['Localização', 'Código localização', 'Produto', 'Código produto', 'Unidade', 'Contado', 'Sistema', 'Diferença', 'Não contado', 'Contado por']
    const corpo = linhas.slice().sort(ordenar).map(l => {
      const p = produtoPorId.get(l.produto_id)
      return [nomeLocal(l.localizacao_id), localPorId.get(l.localizacao_id)?.codigo ?? '', p?.nome ?? '', p?.codigo ?? '', p?.unidade ?? '', num(l.contada), num(l.sistema), num(l.diferenca), l.naoContado ? 'sim' : '', l.contagem?.contado_por_email ?? '']
    })
    const csv = '﻿' + [cab, ...corpo].map(r => r.map(esc).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${selecionado.titulo.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // ------------------------------------------------------------ render
  const linhaDiferenca = (l: Linha) => {
    const p = produtoPorId.get(l.produto_id)
    return <article key={chave(l.produto_id, l.localizacao_id)} className="item-row">
      <span className={`item-icon ${l.diferenca > 0 ? 'mov-entrada' : l.diferenca < 0 ? 'mov-saida' : ''}`}>{l.diferenca === 0 ? <CheckCircle2 size={20}/> : <AlertTriangle size={20}/>}</span>
      <div className="item-main"><div className="item-title"><strong>{p?.nome ?? 'Produto removido'}</strong>{l.naoContado && <span className="small-badge">Não contado → 0</span>}</div>
        <small><MapPin size={12}/> {nomeLocal(l.localizacao_id)} · {p?.codigo}</small></div>
      <div className="inv-nums"><span><small>Contado</small><strong>{qtd(l.contada)}</strong></span><span><small>Sistema</small><strong>{qtd(l.sistema)}</strong></span><span className={l.diferenca > 0 ? 'dif-pos' : l.diferenca < 0 ? 'dif-neg' : 'dif-zero'}><small>Diferença</small><strong>{sinal(l.diferenca)} <em>{p?.unidade}</em></strong></span></div>
    </article>
  }

  return <>
    <div className="page-header"><div><span className="eyebrow">CONTAGEM FÍSICA</span><h1>Inventários</h1><p>Abre um inventário, conta os artigos em cada localização e valida as diferenças. Os ajustes ficam registados no histórico de movimentos.</p></div>
      <button className="btn secondary" onClick={() => { void atualizarTudo() }} disabled={ocupado}><RefreshCcw size={15}/><span>Atualizar</span></button></div>

    {erro && <div className="feedback error global-msg"><Info size={18}/><span>{erro}</span><button aria-label="Fechar erro" onClick={() => setErro('')}><X size={16}/></button></div>}
    {aviso && <div className="feedback success global-msg"><CheckCircle2 size={18}/><span>{aviso}</span><button aria-label="Fechar aviso" onClick={() => setAviso('')}><X size={16}/></button></div>}

    {carregando ? <div className="loading-panel">A carregar os inventários…</div> : <div className="inv-layout">
      <aside className="list-panel inv-side">
        {!aberto && contar && <div className="inv-open">
          <h2>Abrir inventário</h2>
          <form className="form-stack" onSubmit={abrir}>
            <label>Título *<input required minLength={2} maxLength={160} value={titulo} onChange={e => setTitulo(e.target.value)}/></label>
            <label>Âmbito
              <select value={ambito} onChange={e => setAmbito(e.target.value)}>
                <option value="">Todo o armazém</option>
                {localizacoes.map(l => <option key={l.id} value={l.id}>Só {l.nome} · {l.codigo}</option>)}
              </select>
            </label>
            <label>Observação<input maxLength={500} value={obsAbrir} onChange={e => setObsAbrir(e.target.value)} placeholder="Ex.: Fecho de ano, contagem cíclica…"/></label>
            <button className="btn primary full" disabled={ocupado} type="submit">{ocupado ? 'A abrir…' : 'Abrir inventário'} <ArrowRight size={17}/></button>
          </form>
        </div>}
        <div className="list-toolbar"><h2>Inventários</h2><span className="list-count">{inventarios.length}</span></div>
        {!inventarios.length ? <div className="empty-state compact"><ClipboardCheck size={29}/><h3>Sem inventários</h3><p>{contar ? 'Abre o primeiro inventário acima.' : 'Ainda não foi aberto nenhum inventário.'}</p></div>
          : <div className="items-list">{inventarios.map(i => <article key={i.id} className={`item-row selectable ${i.id === selecionadoId ? 'selected' : ''}`} role="button" tabIndex={0} aria-pressed={i.id === selecionadoId} onClick={() => setSelecionadoId(i.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelecionadoId(i.id) } }}>
            <span className={`item-icon ${i.estado === 'aberto' ? 'mov-entrada' : i.estado === 'cancelado' ? 'mov-saida' : ''}`}>{i.estado === 'cancelado' ? <Ban size={19}/> : <ClipboardCheck size={19}/>}</span>
            <div className="item-main"><div className="item-title"><strong>{i.titulo}</strong><span className={`small-badge inv-estado-${i.estado}`}>{estados[i.estado]}</span></div>
              <small>{i.localizacao_id ? nomeLocal(i.localizacao_id) : 'Todo o armazém'} · {formatoData.format(new Date(i.criado_em))}</small></div>
          </article>)}</div>}
      </aside>

      <section className="inv-main">
        {!selecionado ? <div className="list-panel"><div className="empty-state"><ListChecks size={34}/><h3>Nenhum inventário selecionado</h3><p>{contar ? 'Abre um inventário para começar a contar. Durante a contagem continuas a poder registar movimentos.' : 'Escolhe um inventário na lista para ver o resultado.'}</p></div></div> : <>
          <div className="list-panel inv-head">
            <div><span className={`small-badge inv-estado-${selecionado.estado}`}>{estados[selecionado.estado]}</span><h2>{selecionado.titulo}</h2>
              <p className="micro">{selecionado.localizacao_id ? <>Só a localização <strong>{nomeLocal(selecionado.localizacao_id)}</strong></> : 'Todo o armazém'} · aberto {formatoData.format(new Date(selecionado.criado_em))}{selecionado.criado_por_email && ` por ${selecionado.criado_por_email}`}
                {selecionado.fechado_em && <> · {selecionado.estado === 'fechado' ? 'validado' : 'cancelado'} {formatoData.format(new Date(selecionado.fechado_em))}{selecionado.fechado_por_email && ` por ${selecionado.fechado_por_email}`}</>}</p>
              {selecionado.observacao && <p className="micro mov-obs">{selecionado.observacao}</p>}</div>
            <div className="inv-stats">
              <span><strong>{contagens.filter(c => !c.nao_contado).length}</strong><small>contagens</small></span>
              <span><strong>{locaisContados}</strong><small>localizações</small></span>
              <span className={comDiferenca.length ? 'dif-neg' : ''}><strong>{emCurso ? comDiferenca.length : selecionado.ajustes_aplicados}</strong><small>{emCurso ? 'diferenças' : 'ajustes'}</small></span>
            </div>
          </div>

          {emCurso && <div className="tabs" role="tablist">
            <button role="tab" aria-selected={separador === 'contar'} className={`tab ${separador === 'contar' ? 'active' : ''}`} onClick={() => setSeparador('contar')}><ScanLine size={16}/> Contar</button>
            <button role="tab" aria-selected={separador === 'diferencas'} className={`tab ${separador === 'diferencas' ? 'active' : ''}`} onClick={() => setSeparador('diferencas')}><ListChecks size={16}/> Diferenças e validação{comDiferenca.length > 0 && <span className="tab-count">{comDiferenca.length}</span>}</button>
          </div>}

          {emCurso && separador === 'contar' && (!contar ? <div className="helper-box"><Info size={20}/><p>Tens permissão de consulta: podes acompanhar o inventário, mas não registar contagens.</p></div> : <div className="location-grid">
            <section className="list-panel creation-panel">
              <h2>Registar contagem</h2>
              <div className="segmented dois" role="radiogroup" aria-label="Modo de contagem">
                <button type="button" role="radio" aria-checked={modo === 'picar'} className={`segment ${modo === 'picar' ? 'active' : ''}`} onClick={() => setModo('picar')}><ScanLine size={16}/> Cada leitura = 1</button>
                <button type="button" role="radio" aria-checked={modo === 'quantidade'} className={`segment ${modo === 'quantidade' ? 'active' : ''}`} onClick={() => setModo('quantidade')}><Package size={16}/> Indicar quantidade</button>
              </div>
              <p>{modo === 'picar' ? 'Lê a etiqueta da localização e depois a de cada artigo: cada leitura soma uma unidade.' : 'Lê ou escolhe o produto e escreve a quantidade total contada nesta localização.'}</p>

              <form className="scan-form mov-scan" onSubmit={e => { e.preventDefault(); processarCodigo(codigo) }}>
                <label className="scan-input-wrap"><Barcode size={19}/><input ref={leitor} autoFocus aria-label="Ler código de produto ou localização" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Ler LOC-… e depois ARM-…" autoComplete="off" disabled={ocupado && modo === 'picar'}/></label>
                <button className="btn secondary" type="button" onClick={() => setCamera(v => !v)} aria-label={camera ? 'Fechar câmara' : 'Abrir câmara'}><Camera size={17}/></button>
              </form>
              {camera && <BarcodeScanner onRead={processarCodigo} onClose={() => setCamera(false)}/>}

              <form className="form-stack mov-form" onSubmit={guardarQuantidade}>
                <label>Localização a contar *
                  <select required value={localId} onChange={e => setLocalId(e.target.value)} disabled={!!selecionado.localizacao_id}>
                    <option value="">Lê a etiqueta ou escolhe…</option>
                    {localizacoes.map(l => <option key={l.id} value={l.id}>{l.nome} · {l.codigo}</option>)}
                  </select>
                </label>
                {modo === 'quantidade' && <>
                  <label>Produto *
                    <select required value={produtoId} onChange={e => { setProdutoId(e.target.value); const c = contagemPorChave.get(chave(e.target.value, localId)); setQuantidade(c ? String(c.quantidade_contada) : '') }}>
                      <option value="">Escolhe ou lê o código…</option>
                      {produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
                    </select>
                  </label>
                  <label>Quantidade contada *
                    <div className="qty-row">
                      <input required inputMode="decimal" type="number" min={0} step={inteiro(produtoPorId.get(produtoId)?.unidade ?? 'un') ? 1 : 0.001} value={quantidade} onChange={e => setQuantidade(e.target.value)} placeholder="0"/>
                      <span className="qty-unit">{produtoPorId.get(produtoId)?.unidade ?? '—'}</span>
                    </div>
                  </label>
                  {produtoId && localId && contagemPorChave.has(chave(produtoId, localId)) && <p className="micro">Já existe uma contagem para este artigo aqui: o valor vai ser substituído.</p>}
                  <button className="btn primary full" disabled={ocupado || !localId} type="submit">{ocupado ? 'A guardar…' : 'Guardar contagem'} <ArrowRight size={17}/></button>
                </>}
              </form>
            </section>

            <section className="list-panel">
              <div className="list-toolbar"><h2>{localId ? nomeLocal(localId) : 'Localização'}</h2>{localId && <span className="list-count">{contadasAqui.length} contados</span>}</div>
              {!localId ? <div className="empty-state compact"><MapPin size={29}/><h3>Escolhe a localização</h3><p>Lê a etiqueta LOC-… da prateleira ou caixa que vais contar.</p></div> : <>
                {!contadasAqui.length && !porContarAqui.length && <div className="empty-state compact"><Package size={29}/><h3>Nada contado aqui</h3><p>O sistema não tem stock nesta localização. Lê os artigos que encontrares.</p></div>}
                <div className="items-list">
                  {contadasAqui.map(c => {
                    const p = produtoPorId.get(c.produto_id)
                    const dif = Number(c.quantidade_contada) - (saldoPorChave.get(chave(c.produto_id, c.localizacao_id)) ?? 0)
                    return <article key={c.id} className="item-row"><span className="item-icon mov-entrada"><CheckCircle2 size={20}/></span>
                      <div className="item-main"><strong>{p?.nome ?? 'Produto removido'}</strong><small>{p?.codigo} · sistema {qtd(saldoPorChave.get(chave(c.produto_id, c.localizacao_id)) ?? 0)}{dif !== 0 && <span className={dif > 0 ? 'dif-pos' : 'dif-neg'}> ({sinal(dif)})</span>}</small></div>
                      <div className="qty-stepper inv-stepper">
                        {p && inteiro(p.unidade) && <button className="icon-btn" disabled={ocupado} aria-label="Menos um" onClick={() => { void ajustarUm(c, -1) }}><Minus size={15}/></button>}
                        <strong className="qty-big">{qtd(c.quantidade_contada)} <small>{p?.unidade}</small></strong>
                        {p && inteiro(p.unidade) && <button className="icon-btn" disabled={ocupado} aria-label="Mais um" onClick={() => { void ajustarUm(c, 1) }}><Plus size={15}/></button>}
                        <button className="icon-btn" disabled={ocupado} aria-label="Remover contagem" title="Remover contagem" onClick={() => { void removerContagem(c) }}><Trash2 size={15}/></button>
                      </div>
                    </article>
                  })}
                  {porContarAqui.map(s => {
                    const p = produtoPorId.get(s.produto_id)
                    return <article key={s.produto_id} className="item-row inv-pendente"><span className="item-icon"><Package size={20}/></span>
                      <div className="item-main"><strong>{p?.nome ?? 'Produto removido'}</strong><small>{p?.codigo} · por contar · sistema {qtd(s.quantidade)} {p?.unidade}</small></div>
                      {p && <button className="btn ghost" disabled={ocupado} onClick={() => { setModo('quantidade'); setProdutoId(p.id); setQuantidade('') }}>Contar</button>}
                    </article>
                  })}
                </div>
              </>}
            </section>
          </div>)}

          {(!emCurso || separador === 'diferencas') && <div className="list-panel">
            <div className="list-toolbar">
              <h2>{emCurso ? 'Diferenças face ao stock atual' : 'Resultado do inventário'}</h2>
              <div className="inv-tools">
                <label className="checkline"><input type="checkbox" checked={soDiferencas} onChange={e => setSoDiferencas(e.target.checked)}/> Só com diferença</label>
                <button className="btn secondary" disabled={!linhas.length} onClick={exportarCsv}><Download size={15}/><span>CSV</span></button>
              </div>
            </div>
            {emCurso && <label className="checkline inv-zerar"><input type="checkbox" checked={zerar} onChange={e => setZerar(e.target.checked)}/> <span>Pôr a zero os artigos com stock nas localizações contadas que não foram contados <small>(recomendado: se não foi contado, não estava lá)</small></span></label>}
            {!linhasVisiveis.length ? <div className="empty-state compact"><ListChecks size={29}/><h3>{linhas.length ? 'Sem diferenças' : 'Sem contagens'}</h3><p>{linhas.length ? 'Tudo o que foi contado coincide com o stock do sistema.' : 'Ainda não foi registada nenhuma contagem.'}</p></div>
              : <div className="items-list">{linhasVisiveis.map(linhaDiferenca)}</div>}
            {emCurso && <div className="inv-validar">
              {comDiferenca.length > 0 && <p><strong>{sobras}</strong> sobras e <strong>{faltas}</strong> faltas vão ser registadas como ajustes. O stock é recalculado no momento da validação, por isso movimentos feitos entretanto são considerados.</p>}
              {validar ? <div className="item-actions">
                <button className="btn ghost" disabled={ocupado} onClick={() => { void cancelar() }}><Ban size={16}/> Cancelar inventário</button>
                <button className="btn primary" disabled={ocupado || !contagens.length} onClick={() => { void fechar() }}>{ocupado ? 'A validar…' : 'Validar e fechar'} <CheckCircle2 size={17}/></button>
              </div> : <div className="helper-box"><Info size={20}/><p>Só um <strong>administrador</strong> do armazém pode validar os ajustes e fechar o inventário.</p></div>}
            </div>}
          </div>}
        </>}
      </section>
    </div>}
  </>
}
