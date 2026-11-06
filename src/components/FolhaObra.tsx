import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertTriangle, Barcode, Camera, ClipboardList, Info, MapPin, Minus, Package, Plus, Printer, Search, Trash2, X
} from 'lucide-react'
import type { ArmazemAcesso, Localizacao, Produto, StockSaldo } from '../lib/types'
import { codigoFolhaObra, lerCodigo } from '../lib/codigos'
import BarcodeScanner from './BarcodeScanner'
import CodigoBarras from './CodigoBarras'
import { qtd, totalPorProduto } from './Movimentos'

type Linha = { produtoId: string; quantidade: string }
type Rascunho = { obra: string; notas: string; linhas: Linha[] }

const vazio: Rascunho = { obra: '', notas: '', linhas: [] }
const inteiro = (unidade: string) => unidade === 'un' || unidade === 'cx'
const formatoData = new Intl.DateTimeFormat('pt-PT', { dateStyle: 'long' })

// Rascunho guardado só neste navegador, por armazém (conveniência; pode não existir).
const chave = (armazemId: string) => `folha-obra:${armazemId}`
function lerRascunho(armazemId: string): Rascunho {
  try {
    const bruto = localStorage.getItem(chave(armazemId))
    if (!bruto) return vazio
    const r = JSON.parse(bruto) as Partial<Rascunho>
    return { obra: String(r.obra ?? ''), notas: String(r.notas ?? ''), linhas: Array.isArray(r.linhas) ? r.linhas.filter(l => l && typeof l.produtoId === 'string').map(l => ({ produtoId: l.produtoId, quantidade: String(l.quantidade ?? '1') })) : [] }
  } catch { return vazio }
}
function guardarRascunho(armazemId: string, r: Rascunho) {
  try { localStorage.setItem(chave(armazemId), JSON.stringify(r)) } catch { /* sem armazenamento local */ }
}

export default function FolhaObra({ armazem, produtos, localizacoes, saldos, autor }: {
  armazem: ArmazemAcesso
  produtos: Produto[]
  localizacoes: Localizacao[]
  saldos: StockSaldo[]
  autor: string
}) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => lerRascunho(armazem.id))
  const [busca, setBusca] = useState('')
  const [codigo, setCodigo] = useState('')
  const [camera, setCamera] = useState(false)
  const [erro, setErro] = useState('')
  const [impressoes, setImpressoes] = useState(0)
  const { obra, notas, linhas } = rascunho

  useEffect(() => { guardarRascunho(armazem.id, rascunho) }, [armazem.id, rascunho])
  // Pré-carregar o logo da folha impressa.
  useEffect(() => { const img = new Image(); img.src = '/silwood-logo.png' }, [])

  const produtoPorId = useMemo(() => new Map(produtos.map(p => [p.id, p])), [produtos])
  const localPorId = useMemo(() => new Map(localizacoes.map(l => [l.id, l])), [localizacoes])
  const totais = useMemo(() => totalPorProduto(saldos), [saldos])
  const naFolha = useMemo(() => new Set(linhas.map(l => l.produtoId)), [linhas])

  const resultados = useMemo(() => {
    const termo = busca.toLocaleLowerCase('pt-PT').trim()
    return produtos
      .filter(p => p.ativo)
      .filter(p => !termo || `${p.nome} ${p.codigo} ${p.descricao}`.toLocaleLowerCase('pt-PT').includes(termo))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-PT'))
      .slice(0, 60)
  }, [produtos, busca])

  // Onde ir buscar o produto: localizações com stock, a habitual primeiro, depois as maiores.
  function locaisDe(p: Produto) {
    return saldos
      .filter(s => s.produto_id === p.id && Number(s.quantidade) > 0)
      .sort((a, b) => (a.localizacao_id === p.localizacao_id ? -1 : b.localizacao_id === p.localizacao_id ? 1 : Number(b.quantidade) - Number(a.quantidade)))
      .map(s => ({ nome: localPorId.get(s.localizacao_id)?.nome ?? '—', quantidade: Number(s.quantidade) }))
  }

  const atualizar = (parcial: Partial<Rascunho>) => setRascunho(r => ({ ...r, ...parcial }))

  function adicionar(p: Produto, quantidade = 1) {
    setErro('')
    setRascunho(r => r.linhas.some(l => l.produtoId === p.id)
      ? { ...r, linhas: r.linhas.map(l => l.produtoId === p.id ? { ...l, quantidade: String((Number(l.quantidade.replace(',', '.')) || 0) + quantidade) } : l) }
      : { ...r, linhas: [...r.linhas, { produtoId: p.id, quantidade: String(quantidade) }] })
  }

  function alterarQtd(produtoId: string, quantidade: string) {
    atualizar({ linhas: linhas.map(l => l.produtoId === produtoId ? { ...l, quantidade } : l) })
  }

  function passo(produtoId: string, delta: number) {
    const l = linhas.find(x => x.produtoId === produtoId)
    if (!l) return
    alterarQtd(produtoId, String(Math.max(1, (Number(l.quantidade.replace(',', '.')) || 0) + delta)))
  }

  function processarCodigo(lido: string) {
    setCamera(false); setCodigo('')
    const { codigo: c, quantidade } = lerCodigo(lido)
    if (!c) return
    const p = produtos.find(x => x.codigo === c)
    if (!p) return setErro(`O código ${c} não é um produto deste armazém.`)
    if (!p.ativo) return setErro(`${p.nome} está inativo.`)
    adicionar(p, quantidade ?? 1)
  }

  // Validação antes de imprimir.
  const problemas = linhas.flatMap(l => {
    const p = produtoPorId.get(l.produtoId)
    if (!p) return ['Há uma linha com um produto que já não existe. Remove-a.']
    const v = Number(l.quantidade.replace(',', '.'))
    if (!Number.isFinite(v) || v <= 0) return [`Indica a quantidade de ${p.nome}.`]
    if (inteiro(p.unidade) && !Number.isInteger(v)) return [`${p.nome} é contado em unidades inteiras.`]
    return []
  })

  function imprimir() {
    if (obra.trim().length < 2) return setErro('Indica o nome da obra.')
    if (!linhas.length) return setErro('Adiciona pelo menos um produto.')
    if (problemas.length) return setErro(problemas[0])
    setErro('')
    setImpressoes(n => n + 1)
  }

  // Imprime só a folha: durante a impressão a app fica escondida e só a folha aparece.
  // (A folha está sempre no DOM depois da 1.ª impressão, mas invisível no ecrã.)
  useEffect(() => {
    if (!impressoes) return
    document.body.classList.add('a-imprimir-folha')
    const fim = () => document.body.classList.remove('a-imprimir-folha')
    window.addEventListener('afterprint', fim, { once: true })
    // Esperar que o logo carregue (até 2 s) para não sair uma folha sem ele.
    let cancelado = false
    const logo = document.querySelector<HTMLImageElement>('.folha-print .fp-logo')
    const pronto = !logo || logo.complete ? Promise.resolve() : new Promise<void>(res => {
      logo.addEventListener('load', () => res(), { once: true })
      logo.addEventListener('error', () => res(), { once: true })
      window.setTimeout(res, 2000)
    })
    void pronto.then(() => window.setTimeout(() => { if (!cancelado) window.print() }, 80))
    return () => { cancelado = true; window.removeEventListener('afterprint', fim); fim() }
  }, [impressoes])

  function limpar() {
    if (linhas.length && !window.confirm('Limpar a folha atual?')) return
    setRascunho(vazio)
  }

  const linhasValidas = linhas.flatMap(l => {
    const p = produtoPorId.get(l.produtoId)
    const v = Number(l.quantidade.replace(',', '.'))
    return p && v > 0 ? [{ produto: p, quantidade: v }] : []
  })

  return <>
    <div className="page-header"><div><span className="eyebrow">PREPARAÇÃO</span><h1>Folhas de obra</h1><p>Escolhe os produtos e as quantidades para uma obra e imprime a folha. No armazém, lê o QR de cada linha em Entradas e saídas para registar a saída diretamente.</p></div></div>

    {erro && <div className="feedback error global-msg"><Info size={18}/><span>{erro}</span><button aria-label="Fechar erro" onClick={() => setErro('')}><X size={16}/></button></div>}

    <div className="location-grid folha-grid">
      <section className="list-panel creation-panel">
        <h2>Adicionar produtos</h2>
        <form className="scan-form mov-scan" onSubmit={e => { e.preventDefault(); processarCodigo(codigo) }}>
          <label className="scan-input-wrap"><Barcode size={19}/><input aria-label="Ler código do produto" value={codigo} onChange={e => setCodigo(e.target.value)} placeholder="Ler ARM-… para adicionar" autoComplete="off"/></label>
          <button className="btn secondary" type="button" onClick={() => setCamera(v => !v)} aria-label={camera ? 'Fechar câmara' : 'Abrir câmara'}><Camera size={17}/></button>
        </form>
        {camera && <BarcodeScanner onRead={processarCodigo} onClose={() => setCamera(false)}/>}
        <label className="search-bar folha-search"><Search size={18}/><input placeholder="Pesquisar produto…" value={busca} onChange={e => setBusca(e.target.value)}/></label>
        <div className="picker-list">
          {!resultados.length ? <p className="micro">Nenhum produto ativo encontrado.</p> : resultados.map(p => {
            const total = totais.get(p.id) ?? 0
            return <button key={p.id} type="button" className={`picker-row ${naFolha.has(p.id) ? 'in' : ''}`} onClick={() => adicionar(p)}>
              <span className="picker-main"><strong>{p.nome}</strong><small>{p.codigo} · Stock: {qtd(total)} {p.unidade}</small></span>
              <span className="picker-add">{naFolha.has(p.id) ? '+1' : <Plus size={16}/>}</span>
            </button>
          })}
        </div>
      </section>

      <section className="list-panel">
        <div className="creation-panel form-stack folha-head">
          <div className="form-row">
            <label>Obra *<input maxLength={80} value={obra} onChange={e => atualizar({ obra: e.target.value })} placeholder="Ex.: Moradia Rua das Flores, 12"/></label>
            <label>Notas<input maxLength={200} value={notas} onChange={e => atualizar({ notas: e.target.value })} placeholder="Ex.: Entregar até sexta"/></label>
          </div>
        </div>
        <div className="list-toolbar"><h2>Produtos da folha</h2><span className="list-count">{linhas.length} {linhas.length === 1 ? 'linha' : 'linhas'}</span></div>
        {!linhas.length ? <div className="empty-state compact"><ClipboardList size={29}/><h3>Folha vazia</h3><p>Toca num produto à esquerda ou lê a etiqueta para o adicionar.</p></div>
          : <div className="items-list">{linhas.map(l => {
            const p = produtoPorId.get(l.produtoId)
            if (!p) return <article key={l.produtoId} className="item-row"><span className="item-icon warn"><AlertTriangle size={20}/></span><div className="item-main"><strong>Produto removido</strong></div><button className="btn ghost" onClick={() => atualizar({ linhas: linhas.filter(x => x.produtoId !== l.produtoId) })}><Trash2 size={16}/></button></article>
            const total = totais.get(p.id) ?? 0
            const v = Number(l.quantidade.replace(',', '.'))
            const falta = Number.isFinite(v) && v > total
            const locais = locaisDe(p)
            return <article key={l.produtoId} className="item-row">
              <span className={`item-icon ${falta ? 'warn' : ''}`}>{falta ? <AlertTriangle size={20}/> : <Package size={20}/>}</span>
              <div className="item-main">
                <div className="item-title"><strong>{p.nome}</strong>{falta && <span className="small-badge">Stock insuficiente ({qtd(total)})</span>}</div>
                <span className="code-tag"><Barcode size={14}/>{p.codigo}</span>
                {locais.length ? <div className="loc-chips">{locais.slice(0, 3).map(x => <span key={x.nome} className="loc-chip"><MapPin size={12}/>{x.nome}: <strong>{qtd(x.quantidade)}</strong></span>)}</div> : <small className="no-loc">Sem stock em nenhuma localização</small>}
              </div>
              <div className="qty-stepper">
                <button type="button" className="icon-btn" onClick={() => passo(p.id, -1)} aria-label="Menos"><Minus size={16}/></button>
                <input aria-label={`Quantidade de ${p.nome}`} inputMode="decimal" value={l.quantidade} onChange={e => alterarQtd(p.id, e.target.value)}/>
                <button type="button" className="icon-btn" onClick={() => passo(p.id, 1)} aria-label="Mais"><Plus size={16}/></button>
                <span className="qty-unit">{p.unidade}</span>
              </div>
              <button className="icon-btn" title="Remover" aria-label={`Remover ${p.nome}`} onClick={() => atualizar({ linhas: linhas.filter(x => x.produtoId !== l.produtoId) })}><Trash2 size={17}/></button>
            </article>
          })}</div>}
        <div className="folha-actions">
          <button className="btn ghost" onClick={limpar} disabled={!linhas.length && !obra && !notas}>Limpar</button>
          <button className="btn primary" onClick={imprimir}><Printer size={17}/> Imprimir folha</button>
        </div>
      </section>
    </div>
    <p className="micro footnote">A folha fica guardada neste navegador até a limpares. Imprimir não altera o stock: as saídas só são registadas quando leres o QR de cada linha em Entradas e saídas.</p>

    {impressoes > 0 && createPortal(
      <div className="folha-print">
        <div className="fp-brand">
          <img className="fp-logo" src="/silwood-logo.png" alt="Silwood — Mobiliário e Carpintaria"/>
          <div className="fp-meta"><span>{formatoData.format(new Date())}</span><span>Preparada por {autor}</span><span>{linhasValidas.length} {linhasValidas.length === 1 ? 'produto' : 'produtos'}</span></div>
        </div>
        <header className="fp-head">
          <div><span className="fp-eyebrow">FOLHA DE OBRA · {armazem.nome}</span><h1>{obra.trim()}</h1>{notas.trim() && <p>{notas.trim()}</p>}</div>
        </header>
        <p className="fp-tip">Para retirar: em <strong>Entradas e saídas</strong>, lê o <strong>QR</strong> da linha com a câmara — produto, quantidade e obra ficam preenchidos. O código de barras identifica só o produto.</p>
        <div className="fp-rows">
          {linhasValidas.map(({ produto: p, quantidade }, i) => {
            const locais = locaisDe(p)
            return <div className="fp-row" key={p.id}>
              <span className="fp-n">{i + 1}</span>
              <div className="fp-info">
                <strong>{p.nome}</strong>
                <span className="fp-code">{p.codigo}</span>
                <span className="fp-loc">{locais.length ? `Local: ${locais.slice(0, 2).map(x => `${x.nome} (${qtd(x.quantidade)})`).join(', ')}` : 'Sem stock registado'}</span>
              </div>
              <div className="fp-qty"><strong>{qtd(quantidade)}</strong><span>{p.unidade}</span></div>
              <CodigoBarras className="fp-barcode" valor={p.codigo}/>
              <QRCodeSVG className="fp-qr" value={codigoFolhaObra(p.codigo, quantidade, obra)} size={256} level="M" marginSize={1}/>
              <span className="fp-check" aria-hidden="true"/>
            </div>
          })}
        </div>
        <footer className="fp-foot"><span>Retirado por: ______________________</span><span>Data: ____/____/______</span></footer>
      </div>,
      document.body
    )}
  </>
}
