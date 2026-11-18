// Partes comuns das rotas /api (arquivos com "_" na frente não viram rota na Vercel).
import { neon } from '@neondatabase/serverless';
import { createHash, timingSafeEqual } from 'node:crypto';

let sql = null;
let tabelasProntas = null;

// historico: uma linha por análise (só resultados).
// cruzamentos: uma linha por cruzamento de políticas (só os achados; o texto das políticas não é guardado).
// ajustes: chave do Gemini, modelo e normas (texto da norma só sai daqui para o Gemini).
export function banco() {
  sql ??= neon(process.env.DATABASE_URL);
  tabelasProntas ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS historico (
      id text PRIMARY KEY,
      dados jsonb NOT NULL,
      atualizado timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS cruzamentos (
      id text PRIMARY KEY,
      dados jsonb NOT NULL,
      atualizado timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS ajustes (
      nome text PRIMARY KEY,
      valor jsonb NOT NULL,
      atualizado timestamptz NOT NULL DEFAULT now()
    )`;
  })().catch(e => { tabelasProntas = null; throw e; });
  return tabelasProntas.then(() => sql);
}

export async function lerAjuste(db, nome) {
  const linhas = await db`SELECT valor FROM ajustes WHERE nome = ${nome}`;
  return linhas[0]?.valor ?? null;
}
export async function gravarAjuste(db, nome, valor) {
  const json = JSON.stringify(valor);
  await db`INSERT INTO ajustes (nome, valor, atualizado) VALUES (${nome}, ${json}::jsonb, now())
           ON CONFLICT (nome) DO UPDATE SET valor = EXCLUDED.valor, atualizado = now()`;
}

// Chave e modelo: o que foi salvo no Painel Admin vale; GEMINI_API_KEY na Vercel é a reserva.
export async function lerGemini(db) {
  const g = (await lerAjuste(db, 'gemini')) || {};
  return { chave: g.chave || process.env.GEMINI_API_KEY || '', modelo: g.modelo || 'gemini-2.5-flash' };
}

export function ehAdmin(req) {
  const esperada = process.env.APP_SENHA || '';
  const enviada = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!esperada || !enviada) return false;
  const hash = s => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(esperada), hash(enviada));
}

// Responde 401 (com atraso, contra quem tenta adivinhar a senha) e devolve false se não for admin.
export async function exigirAdmin(req, res) {
  if (ehAdmin(req)) return true;
  await new Promise(r => setTimeout(r, 800));
  res.status(401).json({ erro: 'Senha do Painel Admin incorreta.' });
  return false;
}

// Envolve a rota: confere a configuração e transforma falhas do banco em mensagem clara.
export function rota(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!process.env.DATABASE_URL || !process.env.APP_SENHA) {
      return res.status(500).json({ erro: 'O servidor ainda não foi configurado (faltam DATABASE_URL ou APP_SENHA na Vercel).' });
    }
    try {
      return await fn(req, res, await banco());
    } catch (e) {
      console.error(e);
      if (!res.headersSent) return res.status(502).json({ erro: 'Não foi possível falar com o banco de dados. Tente de novo em instantes.' });
    }
  };
}

export function metodoInvalido(res, permitidos) {
  res.setHeader('Allow', permitidos);
  return res.status(405).json({ erro: 'Método não permitido.' });
}
