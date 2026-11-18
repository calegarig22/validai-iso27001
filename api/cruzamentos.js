// Cruzamentos de políticas no Neon, compartilhados por todos que têm o link (tabela própria, separada
// do histórico de análises). Guarda SOMENTE os achados e o nome das políticas, nunca o texto delas.
// Ler e gravar é livre; apagar exige a senha do Painel Admin.
import { rota, exigirAdmin, metodoInvalido } from './_lib.js';

const LIMITE_BYTES = 2_000_000;
const RE_ID = /^[a-z0-9]{6,40}$/;

function analiseValida(a) {
  return a && typeof a === 'object' && RE_ID.test(a.id) && typeof a.data === 'string'
    && a.tipo === 'cruzamento' && typeof a.documentoNome === 'string' && Array.isArray(a.itens) && Array.isArray(a.documentos);
}

export default rota(async (req, res, db) => {
  const id = typeof req.query.id === 'string' ? req.query.id : '';

  if (req.method === 'GET') {
    const linhas = await db`SELECT dados FROM cruzamentos ORDER BY atualizado DESC LIMIT 200`;
    return res.status(200).json({ cruzamentos: linhas.map(l => l.dados) });
  }
  if (req.method === 'PUT') {
    const a = req.body;
    if (!analiseValida(a) || a.id !== id) return res.status(400).json({ erro: 'Cruzamento em formato inválido.' });
    const json = JSON.stringify(a);
    if (Buffer.byteLength(json) > LIMITE_BYTES) return res.status(413).json({ erro: 'Cruzamento grande demais para guardar.' });
    await db`INSERT INTO cruzamentos (id, dados, atualizado) VALUES (${id}, ${json}::jsonb, now())
             ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado = now()`;
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    if (!(await exigirAdmin(req, res))) return;
    if (!RE_ID.test(id)) return res.status(400).json({ erro: 'Identificador inválido.' });
    await db`DELETE FROM cruzamentos WHERE id = ${id}`;
    return res.status(200).json({ ok: true });
  }
  return metodoInvalido(res, 'GET, PUT, DELETE');
});
