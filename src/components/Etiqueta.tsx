import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X } from 'lucide-react'

type Props = { codigo: string; nome: string; categoria: 'Produto' | 'Localização'; local?: string; onClose: () => void }

// Etiqueta de 80 × 47 mm pensada para impressão:
// - QR Code grande (≈28 mm) com margem branca (quiet zone) suficiente;
// - Code 128 com barras de largura inteira e margens laterais largas,
//   escalado para ocupar toda a largura sem barras "borradas".
export default function Etiqueta({ codigo, nome, categoria, local, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    JsBarcode(svg, codigo, {
      format: 'CODE128',
      displayValue: false,
      height: 60,
      width: 2,
      margin: 20,
      background: '#ffffff',
      lineColor: '#000000'
    })
    // Converter o tamanho fixo num viewBox para o SVG escalar com o CSS (em mm).
    const w = svg.getAttribute('width')?.replace('px', '')
    const h = svg.getAttribute('height')?.replace('px', '')
    if (w && h) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.style.removeProperty('transform')
    }
  }, [codigo])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card label-modal" role="dialog" aria-modal="true" aria-label="Etiqueta para impressão">
        <div className="modal-head hide-on-print">
          <div><h2>Etiqueta</h2><p>Imprime e cola no {categoria === 'Produto' ? 'artigo ou na caixa' : 'local indicado'}.</p></div>
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={19}/></button>
        </div>
        <div className="print-area">
          <div className="label-content label-v2">
            <div className="label-top">
              <QRCodeSVG className="label-qr" value={codigo} size={256} level="M" marginSize={3} title={`QR Code ${codigo}`}/>
              <div className="label-info">
                <span className="label-cat">ARMAZÉM · {categoria.toUpperCase()}</span>
                <strong className="label-name">{nome}</strong>
                {local && <span className="label-local">Local: {local}</span>}
                <span className="label-code">{codigo}</span>
              </div>
            </div>
            <svg className="barcode-svg" ref={svgRef} aria-label={`Código de barras ${codigo}`} />
          </div>
        </div>
        <p className="micro hide-on-print label-tip">Na janela de impressão usa <strong>escala 100%</strong> (não "Ajustar à página") e, se possível, a qualidade mais alta da impressora.</p>
        <div className="modal-actions hide-on-print">
          <button className="btn ghost" onClick={onClose}>Fechar</button>
          <button className="btn primary" onClick={() => window.print()}><Printer size={17}/> Imprimir etiqueta</button>
        </div>
      </section>
    </div>
  )
}
