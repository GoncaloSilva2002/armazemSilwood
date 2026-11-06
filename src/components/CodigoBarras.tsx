import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

// Code 128 pensado para impressão: barras de largura inteira, margens laterais largas
// e um viewBox para escalar pelo CSS (em mm) sem deformar a leitura.
export default function CodigoBarras({ valor, className }: { valor: string; className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = ref.current
    if (!svg) return
    JsBarcode(svg, valor, { format: 'CODE128', displayValue: false, height: 60, width: 2, margin: 20, background: '#ffffff', lineColor: '#000000' })
    const w = svg.getAttribute('width')?.replace('px', '')
    const h = svg.getAttribute('height')?.replace('px', '')
    if (w && h) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
      svg.setAttribute('preserveAspectRatio', 'none')
      svg.removeAttribute('width')
      svg.removeAttribute('height')
      svg.style.removeProperty('transform')
    }
  }, [valor])
  return <svg ref={ref} className={className} aria-label={`Código de barras ${valor}`} />
}
