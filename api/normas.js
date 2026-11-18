// Normas ISO guardadas no servidor.
// Qualquer pessoa recebe só a lista de requisitos (id, título, origem), nunca o texto da norma.
// O texto completo só vai para o Painel Admin (com senha) e, durante a análise, para o Gemini.
import { rota, ehAdmin, exigirAdmin, lerAjuste, gravarAjuste, metodoInvalido } from './_lib.js';

const LIMITE_BYTES = 4_000_000;

function semTexto(requisitos) {
  if (!requisitos) return { reqs: [], avisos: [], cortados: 0, juntou: false };
  const { reqs = [], avisos = [], cortados = 0, juntou = false } = requisitos;
  return { reqs: reqs.map(({ key, id, titulo, origem, ordem }) => ({ key, id, titulo, origem, ordem })), avisos, cortados, juntou };
}

export default rota(async (req, res, db) => {
  if (req.method === 'GET') {
    const [normas, requisitos] = await Promise.all([lerAjuste(db, 'normas'), lerAjuste(db, 'requisitos')]);
    const resposta = { nomes: (normas || []).map(n => n.nome), requisitos: semTexto(requisitos) };
    if (req.query.completo === '1') {
      if (!ehAdmin(req)) return exigirAdmin(req, res);
      resposta.normas = normas || [];
    }
    return res.status(200).json(resposta);
  }
  if (req.method === 'PUT') {
    if (!(await exigirAdmin(req, res))) return;
    const { normas, requisitos } = req.body || {};
    if (!Array.isArray(normas) || !requisitos || !Array.isArray(requisitos.reqs)) return res.status(400).json({ erro: 'Normas em formato inválido.' });
    if (Buffer.byteLength(JSON.stringify(req.body)) > LIMITE_BYTES) return res.status(413).json({ erro: 'As normas ficaram grandes demais para guardar.' });
    await gravarAjuste(db, 'normas', normas);
    await gravarAjuste(db, 'requisitos', requisitos);
    return res.status(200).json({ ok: true });
  }
  return metodoInvalido(res, 'GET, PUT');
});
