# Audittax Gestão Integrada

Plataforma web para gestão interna com foco em operação administrativa, estoque, compras, comprovantes fiscais, fornecedores, inventário de T.I. e manutenção predial.

O sistema usa frontend em React + Vite e backend local em Node.js + Express + SQLite, com fluxo de importação fiscal por XML, PDF e imagem.

## Visão geral

Hoje a aplicação cobre quatro frentes principais:

- Estoque administrativo e de limpeza
- Entradas, saídas e compras avulsas
- Patrimônio e inventário de T.I.
- Manutenção predial e comprovantes fiscais

Além do cadastro operacional, o sistema também faz leitura fiscal, vinculação inteligente de itens e armazenamento local dos dados em SQLite.

## Principais recursos

- Dashboard com indicadores operacionais e alertas automáticos
- Controle de estoque com cadastro de itens, estoque mínimo e consumo semanal
- Registro de entradas e saídas manuais
- Importação de nota fiscal via XML, PDF ou imagem
- Preferência por XML fiscal para maior precisão
- Anexo de PDF/imagem do comprovante para auditoria
- Conferência de entrada com totais, diferenças e composição fiscal
- Identificação de desconto, frete, seguro, IPI e outros ajustes do XML
- Vinculação inteligente entre item importado e item já cadastrado
- Confirmação final antes de efetivar a entrada da nota
- Reversão de entrada importada ao excluir lançamento fiscal
- Histórico de preços por item e fornecedor
- Cadastro e gestão de fornecedores
- Gestão de comprovantes e arquivos anexos
- Inventário de informática e comunicação
- Manutenção predial com ativos e registros de manutenção
- Persistência local em SQLite via backend Express

## Módulos da interface

- `Dashboard`: visão geral, alertas e últimas movimentações
- `Ciclo de compras`: previsão da próxima compra geral
- `Linha do tempo`: eventos operacionais e consumo
- `Itens`: cadastro e edição de itens
- `Entrada`: entrada manual e importação fiscal assistida
- `Saída`: baixa manual de estoque
- `Compras avulsas`: reposições extras fora do ciclo
- `Histórico`: movimentações completas
- `Preços`: histórico por item e fornecedor
- `Estimativa de duração`: previsão de consumo
- `Relatórios`: visão de apoio à compra
- `Consumo`: ajuste fino de parâmetros
- `Manutenção Predial`: ativos, categorias e intervenções
- `Inventário de T.I.`: ativos de informática e comunicação
- `Comprovantes`: notas, anexos e exclusão reversível
- `Fornecedores`: cadastro e manutenção
- `Configurações`: ciclo de compras e parâmetros gerais

## Importação fiscal

O fluxo de entrada fiscal foi desenhado para uso prático no dia a dia.

### Ordem recomendada

1. Anexar o `XML fiscal`
2. Anexar o `PDF` ou imagem do comprovante
3. Conferir fornecedor, chave, itens, unidades e totais
4. Confirmar a importação no final da conferência

### O que o sistema faz na conferência

- Lê os itens do XML com maior precisão
- Sugere vínculo com itens já cadastrados
- Permite ajustar unidade, quantidade e valor unitário
- Mostra total dos produtos do XML
- Mostra total selecionado para importação
- Mostra diferença dos produtos
- Mostra total final da NF
- Explica a composição da diferença fiscal:
  - desconto
  - frete
  - seguro
  - IPI
  - outros ajustes

### Exclusão e reversão

Ao excluir uma entrada importada, o sistema diferencia:

- excluir apenas o lançamento fiscal
- reverter a importação completa, com retorno do estoque e dos registros vinculados

Se a reversão puder gerar inconsistência, o backend bloqueia a operação.

## Estrutura do projeto

```text
.
|-- backend/                  # API local, SQLite, OCR, importação fiscal e arquivos
|-- src/                      # Frontend React/Vite
|-- tests/                    # Testes auxiliares do extrator NFC-e
|-- ecosystem.config.cjs      # Configuração PM2
|-- iniciar.bat               # Atalho para iniciar o sistema
|-- instalar-servico.bat      # Instalação como serviço no Windows
|-- gerenciar-servico.bat     # Rotinas de gerenciamento do serviço
|-- index.html                # Entrada do frontend
```

## Stack técnica

### Frontend

- React 18
- Vite 5
- pdfjs-dist
- qr-scanner
- tesseract.js

### Backend

- Node.js
- Express
- better-sqlite3
- multer
- pdf-parse
- pdf-poppler
- sharp
- jsqr
- zxing-wasm
- node-tesseract-ocr

## Requisitos

- Node.js 18+
- npm
- Windows é o cenário mais preparado para o fluxo atual

Para OCR e PDF com melhor resultado, o ambiente pode ter:

- `tesseract` disponível no `PATH`
- `pdftoppm` disponível no `PATH`

## Como rodar localmente

## 1. Frontend

Na raiz do projeto:

```powershell
npm install
npm run dev -- --host 127.0.0.1
```

O frontend sobe via Vite.

## 2. Backend

Em outra janela:

```powershell
cd backend
npm install
npm run dev
```

Por padrão, o backend roda em `http://127.0.0.1:3333`.

## Build do frontend

Na raiz:

```powershell
npm run build
```

## Variáveis de ambiente

### Frontend

Se quiser apontar para outro backend:

```env
VITE_NFCE_API_URL=https://seu-backend.exemplo.com
```

Em ambiente local, o frontend usa `http://127.0.0.1:3333` automaticamente quando não houver variável definida.

### Backend

Variáveis aceitas:

```env
PORT=3333
ANTHROPIC_API_KEY=sua-chave-opcional
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

Observações:

- `ANTHROPIC_API_KEY` é opcional
- sem modelo externo, o sistema continua usando QR Code, leitura textual de PDF e OCR local quando disponível

## Persistência de dados

- Os dados operacionais ficam no SQLite local
- O backend expõe a API para leitura e gravação
- Arquivos de comprovantes e anexos ficam vinculados aos lançamentos fiscais
- Existe suporte à migração inicial de dados legados do `localStorage`

## Scripts principais

### Raiz

```powershell
npm install
npm run dev
npm run build
```

### Backend

```powershell
cd backend
npm install
npm run dev
npm start
```

## Deploy sugerido

### Frontend

Pode ser publicado em hospedagem estática compatível com Vite, como:

- Vercel
- Netlify
- servidor interno com build estático

### Backend

Pode ser executado em:

- servidor Windows interno
- VPS com Node.js
- PM2
- serviço Node com acesso ao SQLite

O arquivo `ecosystem.config.cjs` ajuda no uso com PM2.

## Testes e validação

Validações comuns durante o desenvolvimento:

```powershell
npm run build
node --check backend\server.js
```

Se quiser rodar os testes auxiliares do extrator:

```powershell
cd tests
npm install
npm test
```

## Status atual do produto

O repositório já reflete uma plataforma mais ampla do que um simples controle de estoque. O nome `Audittax Gestão Integrada` representa melhor o escopo atual, que une:

- suprimentos internos
- compras e documentos fiscais
- fornecedores
- patrimônio de T.I.
- manutenção predial
- apoio administrativo

## Observações

- O projeto foi desenhado para uso interno e operação prática
- O fluxo fiscal funciona melhor com XML
- PDF e imagem continuam como contingência e auditoria
- O backend contém dependências específicas para OCR e processamento de documentos
