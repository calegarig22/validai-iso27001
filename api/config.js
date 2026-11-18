// Chave e modelo do Gemini, guardados no servidor.
// Qualquer pessoa só fica sabendo SE há chave e qual modelo está em uso; a chave nunca sai daqui.
import { rota, ehAdmin, exigirAdmin, lerAjuste, gravarAjuste, lerGemini, metodoInvalido } from './_lib.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export default rota(async (req, res, db) => {
  if (req.method === 'GET') {
    const { chave, modelo } = await lerGemini(db);
    // Reserva: modelo que o servidor passou a usar sozinho porque o principal saiu do ar.
    const reserva = (await lerAjuste(db, 'gemini-reserva'))?.modelo || null;
    return res.status(200).json({ configurada: !!chave, modelo, reserva, admin: ehAdmin(req) });
  }
  if (!(await exigirAdmin(req, res))) return;

  if (req.method === 'PUT') {
    const atual = (await lerAjuste(db, 'gemini')) || {};
    const { chave, modelo } = req.body || {};
    if (typeof chave === 'string') atual.chave = chave.trim();
    if (typeof modelo === 'string' && /^[\w.-]{1,80}$/.test(modelo.trim())) {
      atual.modelo = modelo.trim();
      await gravarAjuste(db, 'gemini-reserva', { modelo: null }); // novo modelo escolhido: volta a tentar ele primeiro
    }
    await gravarAjuste(db, 'gemini', atual);
    return res.status(200).json({ ok: true, configurada: !!(atual.chave || process.env.GEMINI_API_KEY) });
  }
  if (req.method === 'POST') {
    // Testa a chave (a digitada agora ou a já salva) listando os modelos liberados para ela.
    const chave = String(req.body?.chave || '').trim() || (await lerGemini(db)).chave;
    if (!chave) return res.status(400).json({ erro: 'Nenhuma chave cadastrada ainda. Cole a chave e teste de novo.' });
    let r;
    try { r = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': chave }, signal: AbortSignal.timeout(20000) }); }
    catch { return res.status(504).json({ erro: 'O Google não respondeu. Tente de novo em instantes.' }); }
    res.status(r.status).setHeader('Content-Type', 'application/json');
    return res.send(await r.text());
  }
  return metodoInvalido(res, 'GET, PUT, POST');
});
