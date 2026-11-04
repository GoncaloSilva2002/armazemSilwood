import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X } from 'lucide-react'

type Props = { codigo: string; nome: string; categoria: 'Produto' | 'Localização'; onClose: () => void }

export default function Etiqueta({ codigo, nome, categoria, onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!svgRef.current) return
    JsBarcode(svgRef.current, codigo, {
      format: 'CODE128',
      displayValue: true,
      fontSize: 13,
      height: 42,
      width: 1.45,
      margin: 7,
      background: '#ffffff',
      lineColor: '#111111'
    })
  }, [codigo])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card label-modal" role="dialog" aria-modal="true" aria-label="Etiqueta para impressão">
        <div className="modal-head hide-on-print">
          <div><h2>Etiqueta</h2><p>Imprime e cola no {categoria === 'Produto' ? 'artigo ou na caixa' : 'local indicado'}.</p></div>
          <button className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={19}/></button>
        </div>
        <div className="print-area">
          <div className="label-content">
            <div className="label-header"><span>ARMAZÉM</span><small>{categoria.toUpperCase()}</small></div>
            <strong className="label-name">{nome}</strong>
            <div className="label-graphics">
              <svg className="barcode-svg" ref={svgRef} aria-label={`Código de barras ${codigo}`} />
              <QRCodeSVG value={codigo} size={78} level="M" marginSize={1} title={`QR Code ${codigo}`}/>
            </div>
            <span className="label-code">{codigo}</span>
          </div>
        </div>
        <div className="modal-actions hide-on-print">
          <button className="btn ghost" onClick={onClose}>Fechar</button>
          <button className="btn primary" onClick={() => window.print()}><Printer size={17}/> Imprimir etiqueta</button>
        </div>
      </section>
    </div>
  )
}
