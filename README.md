# AuditTax Estoque

Sistema web para controle de estoque, compras, comprovantes e importacao de NFC-e, com frontend em React/Vite e backend Node.js para extracao de chave de acesso, OCR e persistencia local.

## O que o sistema faz

- Cadastro e acompanhamento de itens de estoque
- Controle de entradas, saidas e compras avulsas
- Historico de precos e fornecedores
- Gestao de comprovantes e anexos
- Importacao de NFC-e por XML, PDF e imagem
- Leitura de QR Code e fallback por OCR no backend
- Painel visual com indicadores, modais e fluxo operacional em uma unica interface

## Estrutura do projeto

```text
.
|-- backend/                  # API local, OCR, QR Code e persistencia
|-- src/                      # Frontend React/Vite
|-- tests/                    # Testes do extrator NFC-e
|-- ecosystem.config.cjs      # Configuracao PM2
|-- iniciar.bat               # Atalho para iniciar o sistema
|-- instalar-servico.bat      # Instalacao como servico no Windows
|-- gerenciar-servico.bat     # Rotinas de gerenciamento do servico
```

## Requisitos

- Node.js 18+
- npm
- Windows para o fluxo atual de OCR/PDF

O backend funciona melhor com estas dependencias instaladas no sistema:

- `tesseract` no PATH
- `pdftoppm` no PATH (Poppler)

## Como rodar localmente

### 1. Frontend

Na raiz do projeto:

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

O frontend sobe via Vite.

### 2. Backend

Em outra janela, dentro de `backend`:

```powershell
cd backend
npm install
npm run dev
```

Por padrao, o backend roda em `http://127.0.0.1:3333`.

## Variaveis de ambiente

### Frontend

Crie um arquivo `.env` na raiz do projeto quando quiser apontar para um backend publico:

```env
VITE_NFCE_API_URL=https://seu-backend.onrender.com
```

Se essa variavel nao existir em ambiente local, o frontend usa `http://127.0.0.1:3333` automaticamente.

### Backend

O backend aceita estas variaveis:

```env
PORT=3333
ANTHROPIC_API_KEY=sua-chave-opcional
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Observacoes:

- `ANTHROPIC_API_KEY` e opcional
- sem Claude Vision, o sistema continua usando QR Code, leitura de PDF e OCR local quando disponivel

## Testes do extrator NFC-e

Os testes da pasta `tests` cobrem utilitarios do extrator. Para rodar:

```powershell
cd tests
npm install
npm test
```

## Build do frontend

Na raiz do projeto:

```powershell
npm run build
```

## Deploy sugerido

### Frontend

Pode ser publicado em Vercel, Netlify ou outro host estatico compatível com Vite.

Passos basicos:

1. Conectar o repositorio.
2. Configurar `VITE_NFCE_API_URL` com a URL publica do backend.
3. Publicar o build.

### Backend

Hospede a pasta `backend` em um servico Node.js ou VPS Windows/Linux com suporte as dependencias de OCR.

Opcoes comuns:

- Render
- Railway
- VPS propria
- PM2 em servidor Windows

O arquivo `ecosystem.config.cjs` ja ajuda no uso com PM2.

## Importacao de NFC-e

Fluxos suportados hoje:

- `XML`: caminho mais preciso
- `PDF textual`: suportado
- `Imagem`: tenta QR Code primeiro
- `PDF escaneado` e imagem ruim: fallback com OCR local e/ou backend

## Observacoes importantes

- O projeto foi estruturado para operacao local e uso pratico em ambiente interno.
- O backend contem dependencias especificas para OCR e processamento de PDF.
