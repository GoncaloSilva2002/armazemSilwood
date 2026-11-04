import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || ''
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || ''

// Nunca colocar service_role nem secret keys num projeto Vite/browser.
export const configurado = url.startsWith('https://') && !url.includes('SEU-PROJETO') && publishableKey.length > 20 && !publishableKey.includes('SUBSTITUIR')

export const supabase = configurado
  ? createClient(url, publishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    })
  : null
