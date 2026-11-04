import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { CameraOff, ScanLine, X } from 'lucide-react'

type Props = { onRead: (code: string) => void; onClose: () => void }

export default function BarcodeScanner({ onRead, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const onReadRef = useRef(onRead)
  const [erro, setErro] = useState('')
  onReadRef.current = onRead

  useEffect(() => {
    let desmontado = false
    let parar: (() => void | Promise<void>) | undefined
    const reader = new BrowserMultiFormatReader()
    reader.decodeFromVideoDevice(undefined, video.current ?? undefined, (resultado, _erro, controls) => {
      if (!resultado || desmontado) return
      const code = resultado.getText().trim()
      if (!code) return
      void controls.stop()
      onReadRef.current(code)
    }).then(controls => {
      if (desmontado) void controls.stop()
      else parar = () => controls.stop()
    }).catch(() => {
      if (!desmontado) setErro('Não foi possível iniciar a câmara. Autoriza o acesso nas definições e usa HTTPS ou localhost.')
    })
    return () => {
      desmontado = true
      if (parar) void parar()
    }
  }, [])

  return (
    <div className="scanner-shell">
      <div className="scanner-heading">
        <div><ScanLine size={21} /> <strong>Ler código de barras ou QR Code</strong></div>
        <button className="icon-btn" type="button" onClick={onClose} aria-label="Fechar câmara"><X size={20}/></button>
      </div>
      {erro ? <div className="scanner-error"><CameraOff size={25}/><p>{erro}</p></div> : (
        <div className="camera-frame"><video ref={video} muted playsInline autoPlay /><div className="scan-target" /></div>
      )}
      <p className="micro">Alinha o código com o centro da imagem. A leitura termina após identificar um código.</p>
    </div>
  )
}
