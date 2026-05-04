# Migracao para Supabase

Este backend foi preparado para usar `Supabase/Postgres` no lugar do `SQLite` local.

## O que mudou

- A conexao do banco agora usa `DATABASE_URL`
- O schema inicial esta em `backend/supabase/schema.sql`
- O backend inicializa as tabelas automaticamente ao subir
- Existe um script para migrar a base atual de `backend/storage/estoque.db` para o Supabase

## Variaveis de ambiente

Crie ou ajuste `backend/.env` com:

```env
DATABASE_URL=postgresql://postgres.[project-ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
PGSSLMODE=require
PORT=3333
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

## Passo a passo

1. Crie um projeto no Supabase
2. Copie a connection string do Postgres com pooling
3. Configure `DATABASE_URL` no `backend/.env`
4. Rode `npm install` dentro de `backend`
5. Rode `npm run db:init:supabase`
6. Rode `npm run db:migrate:supabase`
7. Suba o backend normalmente com `npm run dev` ou `npm start`

## Observacoes importantes

- Os dados principais passam a ficar no Supabase/Postgres
- Os anexos de comprovantes continuam no filesystem local em `backend/storage/receipts`
- Se o backend for para ambiente serverless, o proximo passo ideal e migrar anexos para `Supabase Storage`
- O script de migracao copia os registros do banco SQLite atual para o Postgres
