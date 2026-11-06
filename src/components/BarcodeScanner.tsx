import { useEffect, useRef, useState } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { lerCodigo } from '../lib/codigos'
import { Check, CameraOff, Flashlight, FlashlightOff, RefreshCcw, ScanLine, SwitchCamera, X, ZoomIn } from 'lucide-react'

type Props = { onRead: (code: string) => void; onClose: () => void }
type Zoom = { min: number; max: number; step: number }

// Só procurar os formatos que a app imprime: a leitura fica mais rápida e fiável.
const hints = new Map<DecodeHintType, unknown>([
  [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]],
  [DecodeHintType.TRY_HARDER, true]
])

// Traduz o erro do navegador numa explicação útil.
function explicarErro(e: unknown) {
  const nome = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e ?? '')
  switch (nome) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'O acesso à câmara foi recusado. Toca no cadeado/ícone ao lado do endereço, permite a Câmara para este site e tenta de novo.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'Não foi encontrada nenhuma câmara neste dispositivo.'
    case 'NotReadableError':
    case 'TrackStartError':
      return 'A câmara está a ser usada por outra aplicação. Fecha outras apps ou separadores que a usem e tenta de novo.'
    case 'OverconstrainedError':
      return 'A câmara escolhida não está disponível. Experimenta trocar de câmara.'
    case 'SecurityError':
      return 'O navegador bloqueou a câmara por motivos de segurança. Abre a app em https:// e aceita o certificado.'
    default:
      return `Não foi possível iniciar a câmara${nome || msg ? ` (${[nome, msg].filter(Boolean).join(': ')})` : ''}.`
  }
}

const CHAVE_CAMERA = 'armazem.camera'
// Aberturas da câmara em fila: nunca pedir a câmara enquanto outro pedido ainda está aberto
// (o React StrictMode monta o componente duas vezes e muitos Android ficam presos com isso).
let fila: Promise<unknown> = Promise.resolve()

function lerCameraGuardada() { try { return localStorage.getItem(CHAVE_CAMERA) } catch { return null } }
function guardarCamera(id: string) { try { localStorage.setItem(CHAVE_CAMERA, id) } catch { /* sem armazenamento */ } }
function pararStream(s: MediaStream | null) { s?.getTracks().forEach(t => t.stop()) }
function semPermissao(e: unknown) {
  const nome = e && typeof e === 'object' && 'name' in e ? String((e as { name: unknown }).name) : ''
  return nome === 'NotAllowedError' || nome === 'PermissionDeniedError' || nome === 'SecurityError'
}
// Pontuação para ordenar câmaras: traseira principal primeiro, frontal no fim.
function pontuacao(d: MediaDeviceInfo) {
  const l = d.label.toLowerCase()
  let p = 0
  if (/back|rear|traseira|environment|trás/.test(l)) p += 2
  if (/front|frontal|user|selfie/.test(l)) p -= 2
  if (/\b0\b/.test(l)) p += 1
  return p
}

// getUserMedia com limite de tempo: em alguns telemóveis o pedido fica pendurado.
function obterStream(video: MediaTrackConstraints, ms = 8000) {
  return new Promise<MediaStream>((resolve, reject) => {
    let terminado = false
    const t = setTimeout(() => { terminado = true; reject(new Error('A câmara não respondeu a tempo')) }, ms)
    navigator.mediaDevices.getUserMedia({ audio: false, video }).then(
      s => { clearTimeout(t); if (terminado) pararStream(s); else resolve(s) },
      e => { clearTimeout(t); if (!terminado) reject(e) }
    )
  })
}

// Espera que o vídeo mostre imagem; falso se não chegar nada dentro do prazo.
function esperarImagem(v: HTMLVideoElement, cancelado: () => boolean, ms = 4000) {
  return new Promise<boolean>(resolve => {
    const inicio = Date.now()
    const verificar = () => {
      if (cancelado()) return resolve(false)
      if (v.readyState >= 2 && v.videoWidth > 0) return resolve(true)
      if (Date.now() - inicio > ms) return resolve(false)
      setTimeout(verificar, 100)
    }
    verificar()
  })
}

export default function BarcodeScanner({ onRead, onClose }: Props) {
  const video = useRef<HTMLVideoElement>(null)
  const alvo = useRef<HTMLDivElement>(null)
  const onReadRef = useRef(onRead)
  const cameraAtual = useRef<string | null>(null)
  const [erro, setErro] = useState('')
  const [tentativa, setTentativa] = useState(0)
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [aIniciar, setAIniciar] = useState(true)
  const [temLanterna, setTemLanterna] = useState(false)
  // Código que está agora dentro da moldura; só é registado quando o utilizador confirma.
  const [detetado, setDetetado] = useState('')
  const detetadoRef = useRef('')
  const [lanterna, setLanterna] = useState(false)
  const [zoom, setZoom] = useState<Zoom | null>(null)
  const [zoomValor, setZoomValor] = useState(1)
  onReadRef.current = onRead

  function trilho() {
    const stream = video.current?.srcObject
    return stream instanceof MediaStream ? stream.getVideoTracks()[0] ?? null : null
  }

  useEffect(() => {
    let desmontado = false
    let stream: MediaStream | null = null
    let ciclo: ReturnType<typeof setTimeout> | undefined
    const v = video.current
    setErro(''); setAIniciar(true); setTemLanterna(false); setLanterna(false); setDetetado(''); detetadoRef.current = ''; setZoom(null)

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setErro(`A câmara só funciona em https:// ou localhost. Estás em ${location.protocol}//${location.host}.`)
      setAIniciar(false)
      return
    }
    if (!v) return
    const el = v

    const resolucao = { width: { ideal: 1920 }, height: { ideal: 1080 } }

    // Abre uma câmara e confirma que chega imagem; se não chegar, liberta-a.
    async function tentar(c: MediaTrackConstraints) {
      const s = await obterStream(c)
      if (desmontado) { pararStream(s); return false }
      stream = s
      el.srcObject = s
      try { await el.play() } catch { /* o autoplay trata disso */ }
      const ok = await esperarImagem(el, () => desmontado)
      if (!ok) { pararStream(s); stream = null; el.srcObject = null }
      return ok
    }

    async function iniciar() {
      if (desmontado) return
      const guardada = cameraId ?? lerCameraGuardada()
      const pedidos: MediaTrackConstraints[] = []
      if (guardada) pedidos.push({ deviceId: { exact: guardada }, ...resolucao })
      if (!cameraId) pedidos.push({ facingMode: { ideal: 'environment' }, ...resolucao })

      let ok = false
      let ultimoErro: unknown = null
      for (const c of pedidos) {
        if (ok || desmontado) break
        try { ok = await tentar(c) } catch (e) { ultimoErro = e; if (semPermissao(e)) break }
      }

      // Depois de autorizada a câmara, os nomes dos dispositivos ficam disponíveis.
      let lista: MediaDeviceInfo[] = []
      try { lista = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput') } catch { /* sem lista */ }
      if (desmontado) return
      setCameras(lista)

      // Nenhuma das tentativas deu imagem: experimentar as outras câmaras, traseiras primeiro.
      if (!ok && !cameraId && !semPermissao(ultimoErro)) {
        for (const d of [...lista].sort((a, b) => pontuacao(b) - pontuacao(a))) {
          if (ok || desmontado) break
          if (!d.deviceId || d.deviceId === guardada) continue
          try { ok = await tentar({ deviceId: { exact: d.deviceId }, ...resolucao }) } catch (e) { ultimoErro = e }
        }
      }
      if (desmontado) return
      const s = stream as MediaStream | null
      if (!ok || !s) throw ultimoErro ?? new Error('A câmara não enviou imagem')

      const track = s.getVideoTracks()[0]
      const id = track?.getSettings?.().deviceId
      if (id) { cameraAtual.current = id; guardarCamera(id) }

      // Ler só o que está dentro da moldura: assim os QR das linhas vizinhas da folha são ignorados.
      const reader = new BrowserMultiFormatReader(hints as Map<DecodeHintType, any>)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      let vistoEm = 0
      const mostrar = (code: string) => {
        if (detetadoRef.current === code) return
        detetadoRef.current = code
        setDetetado(code)
        if (code) { try { navigator.vibrate?.(30) } catch { /* sem vibração */ } }
      }
      const ler = () => {
        if (desmontado) return
        const t = alvo.current
        if (ctx && t && el.videoWidth > 0) {
          // A imagem está em object-fit: cover; converter a moldura do ecrã para píxeis do vídeo.
          const rv = el.getBoundingClientRect(), rt = t.getBoundingClientRect()
          const escala = Math.max(rv.width / el.videoWidth, rv.height / el.videoHeight)
          const ox = (rv.width - el.videoWidth * escala) / 2, oy = (rv.height - el.videoHeight * escala) / 2
          const sx = Math.max(0, (rt.left - rv.left - ox) / escala), sy = Math.max(0, (rt.top - rv.top - oy) / escala)
          const sw = Math.min(el.videoWidth - sx, rt.width / escala), sh = Math.min(el.videoHeight - sy, rt.height / escala)
          if (sw > 10 && sh > 10) {
            const f = Math.min(1, 900 / Math.max(sw, sh))
            canvas.width = Math.round(sw * f); canvas.height = Math.round(sh * f)
            ctx.drawImage(el, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
            let code = ''
            try { code = reader.decodeFromCanvas(canvas).getText().trim() } catch { /* nada na moldura */ }
            // Mostrar o código detetado; esquecê-lo se sair da moldura durante algum tempo.
            if (code) { vistoEm = Date.now(); mostrar(code) }
            else if (Date.now() - vistoEm > 700) mostrar('')
          }
        }
        ciclo = setTimeout(ler, 100)
      }
      ler()
      setAIniciar(false)
      const capT = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean }
      setTemLanterna(!!capT.torch)

      // Foco automático contínuo e zoom, quando a câmara os suporta.
      const cap = (track?.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number; step: number } }
      if (cap.focusMode?.includes('continuous')) {
        void track?.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
      }
      if (cap.zoom && cap.zoom.max > cap.zoom.min) {
        const z = { min: cap.zoom.min, max: Math.min(cap.zoom.max, cap.zoom.min * 5 || 5), step: cap.zoom.step || 0.1 }
        setZoom(z)
        const atual = (track?.getSettings?.() as MediaTrackSettings & { zoom?: number }).zoom
        setZoomValor(atual ?? z.min)
      }
    }

    const tarefa = fila.then(iniciar).catch(e => {
      if (desmontado) return
      setErro(explicarErro(e))
      setAIniciar(false)
    })
    fila = tarefa

    return () => {
      desmontado = true
      clearTimeout(ciclo)
      pararStream(stream)
      stream = null
      if (el.srcObject) el.srcObject = null
    }
  }, [tentativa, cameraId])

  async function alternarLanterna() {
    try { await trilho()?.applyConstraints({ advanced: [{ torch: !lanterna } as MediaTrackConstraintSet] }); setLanterna(!lanterna) } catch { /* lanterna indisponível */ }
  }

  function confirmar() {
    const code = detetadoRef.current
    if (!code) return
    try { navigator.vibrate?.(80) } catch { /* sem vibração */ }
    onReadRef.current(code)
  }

  function mudarZoom(valor: number) {
    setZoomValor(valor)
    void trilho()?.applyConstraints({ advanced: [{ zoom: valor } as MediaTrackConstraintSet] }).catch(() => {})
  }

  function trocarCamera() {
    if (cameras.length < 2) return
    const atual = cameras.findIndex(c => c.deviceId === (cameraId ?? cameraAtual.current))
    setCameraId(cameras[(atual + 1) % cameras.length].deviceId)
  }

  return (
    <div className="scanner-shell">
      <div className="scanner-heading">
        <div><ScanLine size={21} /> <strong>Ler código de barras ou QR Code</strong></div>
        <div className="scanner-tools">
          {temLanterna && !erro && <button className={`icon-btn ${lanterna ? 'on' : ''}`} type="button" onClick={() => { void alternarLanterna() }} aria-label={lanterna ? 'Desligar lanterna' : 'Ligar lanterna'} title="Lanterna">{lanterna ? <FlashlightOff size={20}/> : <Flashlight size={20}/>}</button>}
          {cameras.length > 1 && !erro && <button className="icon-btn" type="button" onClick={trocarCamera} aria-label="Trocar de câmara" title="Trocar de câmara"><SwitchCamera size={20}/></button>}
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Fechar câmara"><X size={20}/></button>
        </div>
      </div>
      {erro && <div className="scanner-error"><CameraOff size={25}/><div><p>{erro}</p><button className="btn secondary" type="button" onClick={() => setTentativa(t => t + 1)}><RefreshCcw size={15}/> Tentar novamente</button></div></div>}
      {/* O vídeo fica sempre montado para que "Tentar novamente" tenha onde abrir a câmara. */}
      <div className="camera-frame" hidden={!!erro} onClick={confirmar}><video ref={video} muted playsInline autoPlay /><div className={`scan-target ${detetado ? 'detetado' : ''}`} ref={alvo} />{aIniciar && <span className="camera-loading">A abrir a câmara…</span>}</div>
      {!erro && !aIniciar && (() => {
        const l = detetado ? lerCodigo(detetado) : null
        return <button className="btn scan-confirm" type="button" disabled={!l} onClick={confirmar}>
          <Check size={18}/>{l ? <span>Registar <strong>{l.codigo}</strong>{l.quantidade ? ` · ${l.quantidade} un` : ''}{l.obra ? ` · ${l.obra}` : ''}</span> : <span>Aponta a moldura a um código</span>}
        </button>
      })()}
      {zoom && !erro && <label className="zoom-row"><ZoomIn size={18}/><input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoomValor} onChange={e => mudarZoom(Number(e.target.value))} aria-label="Zoom"/></label>}
      <p className="micro">Só é lido o código dentro da moldura. Confirma que é o certo e toca em Registar (ou na imagem). Com pouca luz, liga a lanterna; para etiquetas pequenas, usa o zoom.</p>
    </div>
  )
}
