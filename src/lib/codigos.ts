// Formato dos códigos lidos pela app.
//
// - Etiquetas:      "ARM-00000001" (produto) ou "LOC-00000001" (localização).
// - Folha de obra:  "ARM-00000001|5|Nome da obra" (QR com produto, quantidade e obra),
//   para registar a saída diretamente ao "picar" a linha da folha.
//
// O separador "|" só é usado no QR (lido pela câmara). O código de barras da folha
// leva apenas o código do produto, para funcionar com qualquer leitor USB/Bluetooth,
// independentemente da disposição do teclado.

const SEPARADOR = '|'

export interface CodigoLido {
  codigo: string
  quantidade?: number
  obra?: string
}

export function lerCodigo(texto: string): CodigoLido {
  const [codigo = '', qtd, ...resto] = texto.trim().split(SEPARADOR)
  const quantidade = qtd ? Number(qtd.trim().replace(',', '.')) : NaN
  const obra = resto.join(' ').trim()
  return {
    codigo: codigo.trim().toUpperCase(),
    ...(Number.isFinite(quantidade) && quantidade > 0 ? { quantidade } : {}),
    ...(obra ? { obra } : {})
  }
}

export function codigoFolhaObra(codigo: string, quantidade: number, obra: string) {
  const obraLimpa = obra.replaceAll(SEPARADOR, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  return [codigo, String(quantidade), obraLimpa].filter(Boolean).join(SEPARADOR)
}
