import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, ArrowRightLeft, ArrowUpFromLine, Barcode, Boxes,
  Camera, CheckCircle2, History, Info, MapPin, Package, RefreshCcw, Search, X
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { mensagemErro } from '../lib/erros'
import { podeMovimentar } from '../lib/permissoes'
import type { ArmazemAcesso, Localizacao, Movimento, Produto, StockSaldo, TipoMovimento } from '../lib/types'
import BarcodeScanner from './BarcodeScanner'
import { lerCodigo } from '../lib/codigos'

type Separador = 'operacao' | 'stock' | 'historico'
type TipoOperacao = Exclude<TipoMovimento, 'ajuste'>

const tipos: Record<TipoMovimento, { nome: string; icon: LucideIcon; descricao: string }> = {
  entrada: { nome: 'Entrada', icon: ArrowDownToLine, descricao: 'Mercadoria que chega ao armazém.' },
  saida: { nome: 'Saída', icon: ArrowUpFromLine, descricao: 'Mercadoria que sai do armazém.' },
  transferencia: { nome: 'Transferência', icon: ArrowRightLeft, descricao: 'Mudar de uma localização para outra.' },
  ajuste: { nome: 'Ajuste', icon: RefreshCcw, descricao: 'Correção de inventário.' }
}
const tiposOperacao: TipoOperacao[] = ['entrada', 'saida', 'transferencia']

const formatoQtd = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 })
const formatoData = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'short', timeStyle: 'short' })
export const qtd = (valor: number) => formatoQtd.format(Number(valor))
const inteiro = (unidade: string) => unidade === 'un' || unidade === 'cx'

export function totalPorProduto(saldos: StockSaldo[]) {
  const mapa = new Map<string, number>()
  for (const s of saldos) mapa.set(s.produto_id, (mapa.get(s.produto_id) ?? 0) + Number(s.quantidade))
  return mapa
}

export default function Movimentos({ armazem, produtos, localizacoes, saldos, produtoInicial, onRecarregar }: {
  armazem: ArmazemAcesso
  produtos: Produto[]
  localizacoes: Localizacao[]
  saldos: StockSaldo[]
  produtoInicial?: string | null
  onRecarregar: () => Promise<void>
}) {
  const podeRegistar = podeMovimentar(armazem.papel)
  const [separador, setSeparador] = useState<Separador>(podeRegistar ? 'operacao' : 'stock')
  const [tipo, setTipo] = useState<TipoOperacao>('entrada')
  const [produtoId, setProdutoId] = useState(produtoInicial ?? '')
  const [origemId, setOrigemId] = useState('')
  const [destinoId, setDestinoId] = useState(() => produtos.find(p => p.id === produtoInicial)?.localizacao_id ?? '')
  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')
  const [codigo, setCodigo] = useState('')
  const [camera, setCamera] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [historico, setHistorico] = useState<Movimento[]>([])
  const [filtroHistorico, setFiltroHistorico] = useState('')
  const [carregarHist, setCarregarHist] = useState(false)
  const [busca, setBusca] = useState('')
  const [soAbaixo, setSoAbaixo] = useState(false)

  const produtoPorId = useMemo(() => new Map(produtos.map(p => [p.id, p])), [produtos])
  const localPorId = useMemo(() => new Map(localizacoes.map(l => [l.id, l])), [localizacoes])
  const totais = useMemo(() => totalPorProduto(saldos), [saldos])
  const produto = produtoPorId.get(produtoId) ?? null
  const saldosProduto = useMemo(() => saldos.filter(s => s.produto_id === produtoId && Number(s.quantidade) > 0), [saldos, produtoId])
  const disponivelOrigem = Number(saldosProduto.find(s => s.localizacao_id === origemId)?.quantidade ?? 0)
  const precisaOrigem = tipo !== 'entrada'
  const precisaDestino = tipo !== 'saida'

  const carregarHistorico = useCallback(async () => {
    if (!supabase) return
    setCarregarHist(true)
    try {
      let consulta = supabase.from('movimentos')
        .select('id, armazem_id, produto_id, tipo, quantidade, origem_id, destino_id, observacao, efetuado_por, efetuado_por_email, criado_em')
        .eq('armazem_id', armazem.id).order('criado_em', { ascending: false }).limit(200)
      if (filtroHistorico) consulta = consulta.eq('produto_id', filtroHistorico)
      const { data, error } = await consulta
      if (error) throw error
      setHistorico((data || []) as Movimento[])
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível carregar o histórico.'))
    } finally { setCarregarHist(false) }
  }, [armazem.id, filtroHistorico])

  useEffect(() => { if (separador === 'historico') void carregarHistorico() }, [separador, carregarHistorico])

  // Se a origem escolhida deixou de ter stock (ou mudou o produto), limpa-a.
  useEffect(() => {
    if (origemId && !saldosProduto.some(s => s.localizacao_id === origemId)) setOrigemId('')
  }, [saldosProduto, origemId])

  // Ao escolher o produto, sugere a localização habitual: destino nas entradas,
  // origem nas saídas/transferências (se lá houver stock).
  function escolherProduto(id: string, tipoAtual: TipoOperacao = tipo) {
    setProdutoId(id)
    const habitual = produtoPorId.get(id)?.localizacao_id
    if (tipoAtual === 'entrada') { if (habitual) setDestinoId(habitual); return }
    // Origem: a habitual se tiver stock; senão, se só houver uma localização com stock, essa.
    const comStock = saldos.filter(s => s.produto_id === id && Number(s.quantidade) > 0)
    const escolhida = comStock.find(s => s.localizacao_id === habitual) ?? (comStock.length === 1 ? comStock[0] : undefined)
    setOrigemId(escolhida?.localizacao_id ?? '')
  }

  function mudarTipo(novo: TipoOperacao) {
    setTipo(novo); setErro(''); setAviso('')
    if (novo === 'entrada') setOrigemId('')
    if (novo === 'saida') setDestinoId('')
  }

  // Um código lido pode ser um produto (ARM-), uma localização (LOC-) ou
  // uma linha de folha de obra (ARM-…|quantidade|obra), que prepara logo a saída.
  function processarCodigo(lido: string) {
    const { codigo: limpo, quantidade: qtdFolha, obra } = lerCodigo(lido)
    setCamera(false); setCodigo('')
    if (!limpo) return
    setErro(''); setAviso('')
    const p = produtos.find(x => x.codigo === limpo)
    if (p && qtdFolha) {
      setTipo('saida'); setDestinoId('')
      escolherProduto(p.id, 'saida')
      setQuantidade(String(qtdFolha))
      setObservacao(obra ? `Obra: ${obra}` : 'Folha de obra')
      setAviso(`Folha de obra: ${qtd(qtdFolha)} ${p.unidade} de ${p.nome}. Confirma a origem e carrega em Registar saída.`)
      return
    }
    if (p) { escolherProduto(p.id); return }
    const l = localizacoes.find(x => x.codigo === limpo)
    if (!l) return setErro(`O código ${limpo} não está registado neste armazém.`)
    if (tipo === 'entrada') setDestinoId(l.id)
    else if (tipo === 'saida') setOrigemId(l.id)
    else if (!origemId) setOrigemId(l.id)
    else setDestinoId(l.id)
  }

  async function registar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !produto) return setErro('Escolhe o produto.')
    const valor = Number(quantidade.replace(',', '.'))
    if (!Number.isFinite(valor) || valor <= 0) return setErro('Indica uma quantidade maior que zero.')
    if (inteiro(produto.unidade) && !Number.isInteger(valor)) return setErro('Este produto é contado em unidades inteiras.')
    if (precisaOrigem && !origemId) return setErro('Escolhe a localização de origem.')
    if (precisaDestino && !destinoId) return setErro('Escolhe a localização de destino.')
    if (tipo === 'transferencia' && origemId === destinoId) return setErro('A origem e o destino têm de ser diferentes.')
    if (precisaOrigem && valor > disponivelOrigem) return setErro(`Só existem ${qtd(disponivelOrigem)} ${produto.unidade} nessa localização.`)
    setOcupado(true); setErro(''); setAviso('')
    try {
      const { error } = await supabase.rpc('registar_movimento', {
        p_armazem: armazem.id,
        p_produto: produto.id,
        p_tipo: tipo,
        p_quantidade: valor,
        p_origem: precisaOrigem ? origemId : null,
        p_destino: precisaDestino ? destinoId : null,
        p_observacao: observacao.trim()
      })
      if (error) throw error
      setAviso(`${tipos[tipo].nome} registada: ${qtd(valor)} ${produto.unidade} de ${produto.nome}.`)
      // Mantém o tipo e as localizações para registar vários artigos seguidos.
      setProdutoId(''); setQuantidade(''); setObservacao('')
      if (tipo !== 'entrada') setOrigemId('')
      await onRecarregar()
    } catch (e) {
      setErro(mensagemErro(e, 'Não foi possível registar o movimento.'))
    } finally { setOcupado(false) }
  }

  const listaStock = useMemo(() => {
    const termo = busca.toLocaleLowerCase('pt-PT').trim()
    return produtos
      .filter(p => p.ativo || (totais.get(p.id) ?? 0) > 0)
      .map(p => ({ produto: p, total: totais.get(p.id) ?? 0, locais: saldos.filter(s => s.produto_id === p.id && Number(s.quantidade) > 0) }))
      .filter(x => !soAbaixo || (x.produto.stock_minimo > 0 && x.total < x.produto.stock_minimo))
      .filter(x => !termo || `${x.produto.nome} ${x.produto.codigo}`.toLocaleLowerCase('pt-PT').includes(termo))
      .sort((a, b) => a.produto.nome.localeCompare(b.produto.nome, 'pt-PT'))
  }, [produtos, saldos, totais, busca, soAbaixo])
  const abaixoMinimo = produtos.filter(p => p.ativo && p.stock_minimo > 0 && (totais.get(p.id) ?? 0) < p.stock_minimo).length

  const nomeLocal = (id: string | null) => (id && localPorId.get(id)?.nome) || '—'
  const produtosAtivos = produtos.filter(p => p.ativo || (tipo !== 'entrada' && (totais.get(p.id) ?? 0) > 0))

  return <>
    <div className="page-header"><div><span className="eyebrow">MOVIMENTOS</span><h1>Entradas e saídas</h1><p>Regista entradas, saídas e transferências. Cada movimento fica no histórico e não pode ser alterado.</p></div>{!podeRegistar && <span className="role-badge role-consulta">Só consulta</span>}</div>

    <div className="tabs" role="tablist">
      {podeRegistar && <button role="tab" aria-selected={separador === 'operacao'} className={`tab ${separador === 'operacao' ? 'active' : ''}`} onClick={() => setSeparador('operacao')}><ArrowRightLeft size={16}/> Nova operação</button>}
      <button role="tab" aria-selected={separador === 'stock'} className={`tab ${separador === 'stock' ? 'active' : ''}`} onClick={() => setSeparador('stock')}><Boxes size={16}/> Stock atual{abaixoMinimo > 0 && <span className="tab-count">{abaixoMinimo}</span>}</button>
      <button role="tab" aria-selected={separador === 'historico'} className={`tab ${separador === 'historico' ? 'active' : ''}`} onClick={() => setSeparador('historico')}><History size={16}/> Histórico</button>
    </div>

    {erro && <div className="feedback error global-msg"><Info size={18}/><span>{erro}</span><button aria-label="Fechar erro" onClick={() => setErro('')}><X size={16}/></button></div>}
    {aviso && <div className="feedback success global-msg"><CheckCircle2 size={18}/><span>{aviso}</span><button aria-label="Fechar aviso" onClick={() => setAviso('')}><X size={16}/></button></div>}

    {separador === 'operacao' && podeRegistar && <div className="location-grid">
      <section className="list-panel creation-panel">
        <div className="segmented" role="radiogroup" aria-label="Tipo de movimento">
          {tiposOperacao.map(t => { const T = tipos[t].icon; return <button key={t} type="button" role="radio" aria-checked={tipo === t} className={`segment seg-${t} ${tipo === t ? 'active' : ''}`} onClick={() => mudarTipo(t)}><T size={17}/> {tipos[t].nome}</button> })}
        </div>
        <p>{tipos[tipo].descricao}</p>

        <form className="scan-form mov-scan" onSubmit={e => { e.preventDefault(); processarCodigo(codigo) }}>
          <label className="scan-input-wrap"><Barcode size={19}/><input aria-label="Ler código de produto ou localização" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Ler ARM-… ou LOC-…" autoComplete="off"/></label>
          <button className="btn secondary" type="button" onClick={() => setCamera(v => !v)} aria-label={camera ? 'Fechar câmara' : 'Abrir câmara'}><Camera size={17}/></button>
        </form>
        {camera && <BarcodeScanner onRead={processarCodigo} onClose={() => setCamera(false)}/>}

        <form className="form-stack mov-form" onSubmit={registar}>
          <label>Produto *
            <select required value={produtoId} onChange={e => escolherProduto(e.target.value)}>
              <option value="">Escolhe ou lê o código…</option>
              {produtosAtivos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
            </select>
          </label>
          {produto && <div className="code-inline"><Package size={16}/> <strong>{qtd(totais.get(produto.id) ?? 0)} {produto.unidade}</strong> em stock <small>{produto.localizacao_id ? <>Habitual: {nomeLocal(produto.localizacao_id)}</> : 'Sem localização habitual'}</small></div>}

          {precisaOrigem && <label>Origem *
            <select required value={origemId} onChange={e => setOrigemId(e.target.value)} disabled={!produto}>
              <option value="">{!produto ? 'Escolhe primeiro o produto' : saldosProduto.length ? 'Escolhe a localização…' : 'Sem stock em nenhuma localização'}</option>
              {saldosProduto.map(s => <option key={s.localizacao_id} value={s.localizacao_id}>{nomeLocal(s.localizacao_id)} · {qtd(s.quantidade)} {produto?.unidade}</option>)}
            </select>
          </label>}

          {precisaDestino && <label>Destino *
            <select required value={destinoId} onChange={e => setDestinoId(e.target.value)}>
              <option value="">{localizacoes.length ? 'Escolhe a localização…' : 'Cria primeiro uma localização'}</option>
              {localizacoes.filter(l => l.id !== origemId).map(l => <option key={l.id} value={l.id}>{l.nome} · {l.codigo}{l.id === produto?.localizacao_id ? ' (habitual)' : ''}</option>)}
            </select>
          </label>}

          <label>Quantidade *
            <div className="qty-row">
              <input required inputMode="decimal" type="number" min={inteiro(produto?.unidade ?? 'un') ? 1 : 0.001} step={inteiro(produto?.unidade ?? 'un') ? 1 : 0.001} value={quantidade} onChange={e => setQuantidade(e.target.value)} placeholder="0"/>
              <span className="qty-unit">{produto?.unidade ?? '—'}</span>
              {precisaOrigem && origemId && <button type="button" className="btn ghost" onClick={() => setQuantidade(String(disponivelOrigem))}>Tudo ({qtd(disponivelOrigem)})</button>}
            </div>
          </label>
          <label>Observação<input maxLength={500} value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Ex.: Guia de remessa 1234, cliente, motivo…"/></label>
          <button className={`btn primary full`} disabled={ocupado} type="submit">{ocupado ? 'A registar…' : `Registar ${tipos[tipo].nome.toLowerCase()}`} <ArrowRight size={17}/></button>
        </form>
      </section>

      <section className="list-panel">
        <div className="list-toolbar"><h2>{produto ? `Stock de ${produto.nome}` : 'Stock por localização'}</h2></div>
        {!produto ? <div className="empty-state compact"><Package size={29}/><h3>Escolhe um produto</h3><p>Lê a etiqueta do produto ou escolhe-o na lista para ver onde está guardado.</p></div>
          : !saldosProduto.length ? <div className="empty-state compact"><Boxes size={29}/><h3>Sem stock</h3><p>Este produto ainda não tem quantidades em nenhuma localização.</p></div>
          : <div className="items-list">{saldosProduto.map(s => <article key={s.localizacao_id} className={`item-row selectable ${origemId === s.localizacao_id ? 'selected' : ''}`} onClick={() => { if (precisaOrigem) setOrigemId(s.localizacao_id) }}><span className="item-icon"><MapPin size={20}/></span><div className="item-main"><strong>{nomeLocal(s.localizacao_id)}</strong><span className="code-tag">{localPorId.get(s.localizacao_id)?.codigo}</span></div><strong className="qty-big">{qtd(s.quantidade)} <small>{produto.unidade}</small></strong></article>)}</div>}
      </section>
    </div>}

    {separador === 'stock' && <div className="list-panel">
      <div className="list-toolbar"><label className="search-bar"><Search size={18}/><input placeholder="Pesquisar produto…" value={busca} onChange={e => setBusca(e.target.value)}/></label><label className="checkline"><input type="checkbox" checked={soAbaixo} onChange={e => setSoAbaixo(e.target.checked)}/> Só abaixo do mínimo ({abaixoMinimo})</label></div>
      {!listaStock.length ? <div className="empty-state compact"><Boxes size={29}/><h3>{busca || soAbaixo ? 'Nenhum resultado' : 'Sem produtos'}</h3><p>{soAbaixo ? 'Nenhum produto está abaixo do stock mínimo.' : 'Cria produtos e regista entradas para ver o stock.'}</p></div>
        : <div className="items-list">{listaStock.map(({ produto: p, total, locais }) => {
          const baixo = p.stock_minimo > 0 && total < p.stock_minimo
          return <article key={p.id} className="item-row"><span className={`item-icon ${baixo ? 'warn' : ''}`}>{baixo ? <AlertTriangle size={20}/> : <Package size={20}/>}</span>
            <div className="item-main"><div className="item-title"><strong>{p.nome}</strong>{baixo && <span className="small-badge">Abaixo do mínimo ({qtd(p.stock_minimo)})</span>}{!p.ativo && <span className="small-badge">Inativo</span>}</div><span className="code-tag"><Barcode size={14}/>{p.codigo}</span>{p.localizacao_id && <small>Localização habitual: {nomeLocal(p.localizacao_id)}</small>}
              {locais.length > 0 && <div className="loc-chips">{locais.map(s => <span key={s.localizacao_id} className="loc-chip"><MapPin size={12}/>{nomeLocal(s.localizacao_id)}: <strong>{qtd(s.quantidade)}</strong></span>)}</div>}
            </div>
            <div className="stock-side"><strong className="qty-big">{qtd(total)} <small>{p.unidade}</small></strong>{podeRegistar && <button className="btn secondary" onClick={() => { escolherProduto(p.id); setSeparador('operacao') }}><ArrowRightLeft size={15}/><span>Movimentar</span></button>}</div>
          </article>
        })}</div>}
    </div>}

    {separador === 'historico' && <div className="list-panel">
      <div className="list-toolbar"><label className="search-bar"><Package size={18}/><select className="with-icon" value={filtroHistorico} onChange={e => setFiltroHistorico(e.target.value)}><option value="">Todos os produtos</option>{produtos.map(p => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}</select></label><button className="btn secondary" disabled={carregarHist} onClick={() => { void carregarHistorico() }}><RefreshCcw size={15}/><span>Atualizar</span></button></div>
      {carregarHist && !historico.length ? <div className="loading-panel">A carregar o histórico…</div>
        : !historico.length ? <div className="empty-state compact"><History size={29}/><h3>Sem movimentos</h3><p>Os movimentos registados aparecem aqui, do mais recente para o mais antigo.</p></div>
        : <div className="items-list">{historico.map(m => {
          const T = tipos[m.tipo].icon
          const p = produtoPorId.get(m.produto_id)
          const sinal = m.tipo === 'entrada' ? '+' : m.tipo === 'saida' ? '−' : ''
          return <article key={m.id} className="item-row"><span className={`item-icon mov-${m.tipo}`}><T size={20}/></span>
            <div className="item-main"><div className="item-title"><strong>{p?.nome ?? 'Produto removido'}</strong><span className={`small-badge mov-badge-${m.tipo}`}>{tipos[m.tipo].nome}</span></div>
              <small>{m.origem_id && nomeLocal(m.origem_id)}{m.origem_id && m.destino_id && ' → '}{m.destino_id && nomeLocal(m.destino_id)} · {formatoData.format(new Date(m.criado_em))} · {m.efetuado_por_email || 'utilizador'}</small>
              {m.observacao && <small className="mov-obs">{m.observacao}</small>}
            </div>
            <strong className={`qty-big mov-qty-${m.tipo}`}>{sinal}{qtd(m.quantidade)} <small>{p?.unidade}</small></strong>
          </article>
        })}</div>}
      {historico.length === 200 && <p className="micro footnote" style={{ padding: '0 23px 16px' }}>A mostrar os 200 movimentos mais recentes. Filtra por produto para ver mais antigos.</p>}
    </div>}
  </>
}
