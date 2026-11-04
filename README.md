# Armazém — MVP, fase 1

Aplicação em **português de Portugal**, construída com React, TypeScript, Vite e Supabase.

## O que já funciona (fase 1)

- Registo e início de sessão (Supabase Auth).
- Criação automática de um armazém individual para cada conta.
- Criação, pesquisa, edição e desativação de produtos.
- Códigos internos únicos atribuídos **na base de dados**: `ARM-00000001` etc.
- Criação e alteração de localizações (estantes, corredores, caixas), com códigos `LOC-00000001` etc.
- Emissão e impressão de etiquetas com **Code 128** e **QR Code**, ambos com o mesmo identificador interno.
- Leitura pela câmara do telemóvel ou computador com `@zxing/browser`, com autorização de câmara.
- Compatibilidade com leitores de códigos de barras/QR **USB ou Bluetooth em modo teclado (HID)**: manter focado o campo de leitura, configurar o leitor para enviar `Enter` após o código.
- Base de dados protegida por RLS (cada conta acede apenas aos seus próprios dados).
- Interface responsiva e manifesto web para utilização em dispositivos móveis.

### O que ainda não funciona

A base de dados **já contém a estrutura** para `stock_saldos`, `movimentos`, `inventarios` e `contagens_inventario`, mas ainda não existe lógica para entradas, saídas, transferências, contagem física ou relatórios. As tabelas futuras têm **apenas acesso de leitura** para a aplicação: serão escritas por funções transacionais com validações numa etapa posterior. Isto evita apresentar stock inventado ou escrever dados de forma insegura.

A aplicação ainda **não funciona offline**. O manifesto não inclui cache/service worker: a instalação PWA poderá depender do navegador e as funcionalidades offline serão tratadas numa fase posterior. O registo de utilizadores é individual; partilha de armazém entre contas exige uma migração para membros e papéis. O catálogo lê até 1.000 registos de cada tipo nesta fase.

## Requisitos

- Node.js 20.19+ ou 22.12+ (recomendado Node.js 22 LTS).
- Uma conta e um projeto no [Supabase](https://supabase.com).
- Navegador atual, HTTPS em produção para usar a câmara.
- Para imprimir: impressora A4 ou impressora de etiquetas; ajusta as dimensões no diálogo de impressão conforme o papel utilizado.

## 1. Criar o projeto Supabase

1. Em https://supabase.com/dashboard, cria um novo projeto.
2. Na secção **SQL Editor**, abre `supabase/migrations/001_init.sql`, copia todo o conteúdo e executa-o **uma única vez num projeto novo**.
3. Em **Authentication > Providers**, confirma que o início de sessão por email está ativo. Se a confirmação de email estiver ligada, confirma o endereço antes de iniciar sessão.
4. Em **Connect** ou **Project Settings > API**, copia o `Project URL` e a **publishable key** do projeto. Uma `anon` key antiga também pode ser usada como chave pública, mas nunca uma `service_role` ou `secret key`.

> O SQL usa *Row Level Security* e GRANTs restritivos: as tabelas do armazém não são acessíveis por visitantes não autenticados. O responsável do armazém é a conta que o criou.

## 2. Configurar o projeto local

Na pasta raiz do projeto, executa:

```bash
npm install
cp .env.example .env.local
```

No Windows, em vez de `cp`, usa `copy .env.example .env.local` ou cria o ficheiro manualmente.

No `.env.local`, preenche:

```env
VITE_SUPABASE_URL=https://teu-projeto.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

**Nunca coloques uma chave secreta em variáveis `VITE_`** — essas variáveis ficam incluídas no JavaScript entregue ao navegador.

## 3. Abrir a aplicação

```bash
npm run dev
```

Abre http://localhost:5173 no computador. Cria uma conta, inicia sessão e começa a registar produtos. Para usar o telemóvel, publica a aplicação num alojamento com HTTPS; o desenvolvimento local num telemóvel através de IP HTTP normalmente não permite aceder à câmara.

## 4. Experimentar o primeiro módulo

1. Em **Produtos**, clica em **Novo produto** e preenche o nome.
2. Guarda. A base de dados gera um código `ARM-xxxxxxxx` exclusivo.
3. Carrega em **Etiqueta** para imprimir Code 128 e QR Code.
4. Em **Localizações**, cria `A-03-02` e imprime a sua etiqueta `LOC-xxxxxxxx`.
5. Em **Ler códigos**, abre a câmara ou liga o leitor HID e verifica se o produto/localização é identificado.

> **Importante:** os códigos `ARM-...` e `LOC-...` são internos à tua aplicação. Não são GTIN/EAN-13 oficiais para comércio ou plataformas de retalho. Para códigos comerciais GS1 seria necessário um processo de atribuição adequado.

## 5. Verificar e publicar

```bash
npm run typecheck
npm run build
npm run preview
```

O resultado da compilação fica em `dist/`. Pode ser alojado numa plataforma estática com HTTPS (por exemplo Vercel, Netlify ou Cloudflare Pages). Configura as mesmas duas variáveis públicas de ambiente nesse alojamento. No Supabase, configura os URLs permitidos de redirecionamento/autenticação para o domínio publicado, se utilizares confirmação por email.

## Estrutura

```text
armazem-mvp/
├── public/
│   ├── icon.svg
│   └── manifest.webmanifest
├── src/
│   ├── components/
│   │   ├── BarcodeScanner.tsx    # ZXing: Code 128 e QR Code por câmara
│   │   └── Etiqueta.tsx          # geração Code 128 e QR, impressão
│   ├── lib/
│   │   ├── supabase.ts          # ligação segura com publishable key
│   │   └── types.ts             # tipos TypeScript
│   ├── App.tsx                  # Auth, produtos, localizações e leitura
│   ├── main.tsx
│   ├── vite-env.d.ts
│   └── styles.css
├── supabase/migrations/
│   └── 001_init.sql             # tabelas, índices, grants e RLS
├── .env.example
├── package.json
└── README.md
```

## Próximas etapas, pela ordem recomendada

1. **Fase 2:** funções RPC transacionais para entradas, saídas e transferências, validação de stock não negativo, histórico imutável e ecrãs de operações.
2. **Fase 3:** abertura e fecho de inventários, contagens por localização e ajustes validados.
3. **Fase 4:** suporte de vários utilizadores por armazém com convites, permissões, relatórios e exportação.
4. **Fase 5:** sincronização offline, serviço PWA mais completo e modelos de etiquetas para impressoras específicas.

## Decisões de segurança

- Cada conta possui um armazém em v1, com isolamento por `auth.uid()`.
- Os clientes só podem criar/editar colunas necessárias em produtos e localizações. **O código é gerado no PostgreSQL** e não pode ser alterado via API com as permissões de utilizador.
- Não há permissões para apagar registos nem para alterar quantidades de stock diretamente.
- É necessário testar as políticas RLS antes de dar acesso a dados reais; a migração não substitui testes de integração com duas contas distintas.
- O texto lido por leitores é tratado como identificador de consulta, nunca como comando.

## Diagnóstico

- **Não aparece nenhum produto:** confirma o SQL e se iniciaste sessão na mesma conta em que criaste o artigo.
- **Erro 42501 / permission denied:** confirma a migração completa, incluindo GRANTs e políticas RLS.
- **A câmara não liga:** abre a app em `https://` ou em `http://localhost`, autoriza a câmara e fecha outras apps que a estejam a usar.
- **O leitor USB/Bluetooth não encontra códigos:** usa o modo teclado (HID), verifica o foco no campo de pesquisa e configura o sufixo Enter no leitor.
- **Não imprime corretamente:** define papel/escala e margens no diálogo de impressão; o CSS utiliza como base uma etiqueta de 80 × 47 mm.

**Nota:** é código-fonte para executares e adaptares. Não está ligado a um Supabase real nem publicado numa loja de aplicações. Não inclui dados pessoais de demonstração.
