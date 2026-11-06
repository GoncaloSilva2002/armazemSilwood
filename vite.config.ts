import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS com certificado local: os navegadores só permitem a câmara em HTTPS (ou localhost),
// por isso sem isto o telemóvel na rede local não consegue ler códigos.
export default defineConfig({ plugins: [react(), basicSsl()] })
