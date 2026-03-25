# AuditTax Estoque

## Frontend local

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

## Backend local

```powershell
cd backend
npm install
npm run dev
```

## Variavel do frontend

Crie um arquivo `.env` na raiz do frontend com:

```env
VITE_NFCE_API_URL=https://seu-backend.onrender.com
```

Em ambiente local, se essa variavel nao existir, o frontend usa `http://127.0.0.1:3333` automaticamente.

## Deploy sugerido

### Frontend na Vercel

1. Conecte este repositorio na Vercel.
2. Configure a variavel `VITE_NFCE_API_URL` com a URL publica do backend.
3. Faça o deploy.

### Backend separado

Hospede a pasta `backend` em um servico Node.js como Render, Railway ou VPS.

Variaveis recomendadas no backend:

```env
PORT=3333
ANTHROPIC_API_KEY=sua-chave
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## Importacao NFC-e

- `XML`: caminho mais preciso
- `PDF textual`: suportado
- `Imagem/PDF escaneado`: depende do backend e/ou OCR
