// Conversa com o Gemini, comum à análise (/api/avaliar) e ao cruzamento de políticas (/api/cruzar).
// Usa a chave e o modelo do Painel Admin; se o modelo estiver fora do ar, sem cota ou sobrecarregado,
// tenta outros modelos Flash e guarda o que funcionou. A resposta do Google volta como veio (mesmo status),
// para o navegador tratar limites e erros.
import { lerAjuste, gravarAjuste, lerGemini } from './_lib.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const TEMPO_MAXIMO = 145000;   // por tentativa
const PRAZO_TOTAL = 270000;    // somando as tentativas com outros modelos (a função vive até 300 s)
const MAX_TENTATIVAS = 8;      // modelo principal + reservas (404 responde na hora, então dá para tentar vários)
const MAX_DEMORADAS = 3;       // tentativas que gastam tempo de verdade (sobrecarga, demora)

// Raciocínio interno ("thinking") curto: deixa cada pedido muito mais rápido e quase não muda a avaliação.
const modelosSemAjusteDeRaciocinio = new Set();
function ajusteDeRaciocinio(modelo) {
  if (modelosSemAjusteDeRaciocinio.has(modelo)) return null;
  const v = parseFloat((modelo.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  if (v >= 3) return { thinkingLevel: 'low' };
  if (v >= 2.5 && /flash/.test(modelo)) return { thinkingBudget: 0 };
  if (v >= 2.5) return { thinkingBudget: 128 };
  return null;
}

// Modelos reserva: quando o principal está sobrecarregado (503), sem cota (429) ou fora do ar (404/500),
// tenta outros modelos Flash liberados para a chave. Cada modelo tem a sua própria cota no plano gratuito.
// O Google às vezes tira um modelo do ar sem aviso (responde 404 no meio de uma análise); por isso o último
// modelo que funcionou fica guardado no banco e passa a ser usado primeiro até o principal voltar.
const ERROS_QUE_TROCAM_DE_MODELO = new Set([404, 429, 500, 503]);
const indisponivelAte = new Map(); // modelo -> horário em que vale tentar de novo
let listaModelos = { ate: 0, nomes: [] };
const versao = n => parseFloat((n.match(/^gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
async function modelosReserva(chave, principal) {
  if (Date.now() > listaModelos.ate) {
    try {
      const r = await fetch(`${API}/models?pageSize=1000`, { headers: { 'x-goog-api-key': chave }, signal: AbortSignal.timeout(10000) });
      const j = await r.json();
      const nomes = (j.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map(m => String(m.name).replace(/^models\//, ''))
        .filter(n => /^gemini-([\d.]+-flash|flash(-lite)?-latest$)/.test(n) && !/(image|tts|audio|live|embedding|vision|robotics|computer-use|native|learnlm)/i.test(n));
      listaModelos = { ate: Date.now() + (nomes.length ? 3600000 : 60000), nomes };
    } catch { listaModelos = { ate: Date.now() + 60000, nomes: [] }; }
  }
  // Mais novos primeiro (os antigos são os que o Google desliga); na mesma versão, estável antes de prévia
  // e Flash antes de Flash-Lite. Se a lista do Google falhar, usa nomes conhecidos como última saída.
  const peso = n => (/(preview|exp)/.test(n) ? 2 : 0) + (/lite/.test(n) ? 1 : 0);
  const nomes = listaModelos.nomes.length ? listaModelos.nomes : ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-lite-latest'];
  return nomes
    .filter(n => n !== principal)
    .sort((a, b) => versao(b) - versao(a) || peso(a) - peso(b) || a.length - b.length);
}
function marcarIndisponivel(modelo, status, texto) {
  const diario = status === 429 && /per.?day|daily|limit:\s*0\b/i.test(texto);
  indisponivelAte.set(modelo, Date.now() + (diario ? 3600000 : status === 404 ? 86400000 : 120000));
}

function pedirAoGoogle(chave, modelo, pedido, comAjuste, tempo) {
  const generationConfig = { temperature: 0, responseMimeType: 'application/json', responseSchema: pedido.esquema };
  const raciocinio = comAjuste && ajusteDeRaciocinio(modelo);
  if (raciocinio) generationConfig.thinkingConfig = raciocinio;
  return fetch(`${API}/models/${encodeURIComponent(modelo)}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': chave, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: pedido.sistema }] },
      contents: [{ role: 'user', parts: [{ text: pedido.usuario }] }],
      generationConfig
    }),
    signal: AbortSignal.timeout(tempo)
  });
}

async function tentarModelo(chave, modelo, pedido, tempo) {
  let r = await pedirAoGoogle(chave, modelo, pedido, true, tempo);
  let texto = await r.text();
  // Modelo que não aceita o ajuste: tenta de novo sem ele e não usa mais neste modelo.
  if (r.status === 400 && /thinking/i.test(texto) && !modelosSemAjusteDeRaciocinio.has(modelo)) {
    modelosSemAjusteDeRaciocinio.add(modelo);
    r = await pedirAoGoogle(chave, modelo, pedido, false, tempo);
    texto = await r.text();
  }
  return { status: r.status, texto };
}

// pedido = { sistema, usuario, esquema }. Responde ao navegador com o que o Google devolveu.
export async function responderComGemini(db, res, pedido) {
  const { chave, modelo } = await lerGemini(db);
  if (!chave) return res.status(503).json({ erro: 'O administrador ainda não cadastrou a chave do Gemini. Avise quem cuida do app.' });

  // Ordem: principal (se não falhou há pouco), o último que funcionou, as reservas e, por fim, o principal.
  const inicio = Date.now();
  const livre = m => (indisponivelAte.get(m) || 0) < Date.now();
  const salvo = (await lerAjuste(db, 'gemini-reserva'))?.modelo;
  const tentados = new Set();
  let ultimo = null, demoradas = 0;
  for (let t = 0; t < MAX_TENTATIVAS && demoradas < MAX_DEMORADAS; t++) {
    let proximo = null;
    if (t === 0 && livre(modelo)) proximo = modelo;
    else if (salvo && salvo !== modelo && !tentados.has(salvo) && livre(salvo)) proximo = salvo;
    else {
      const candidatos = [...await modelosReserva(chave, modelo), modelo].filter(m => !tentados.has(m));
      proximo = candidatos.find(livre) || candidatos[0];
    }
    if (!proximo) break;
    tentados.add(proximo);
    const tempo = Math.min(TEMPO_MAXIMO, PRAZO_TOTAL - (Date.now() - inicio));
    if (tempo < 20000) break;
    try {
      const r = await tentarModelo(chave, proximo, pedido, tempo);
      ultimo = { ...r, modelo: proximo };
      if (!ERROS_QUE_TROCAM_DE_MODELO.has(r.status)) break;
      marcarIndisponivel(proximo, r.status, r.texto);
      if (r.status !== 404) demoradas++;
    } catch (e) {
      demoradas++;
      const demorou = e?.name === 'TimeoutError';
      if (demorou) marcarIndisponivel(proximo, 503, '');
      if (!ultimo?.texto) ultimo = { status: demorou ? 504 : 502, erro: demorou ? 'O Google demorou demais para responder.' : 'O servidor não conseguiu falar com o Google.' };
    }
  }
  // Guarda (ou limpa) o modelo que funcionou, para os próximos pedidos e próximas análises irem direto nele.
  if (ultimo?.status === 200) {
    const novo = ultimo.modelo === modelo ? null : ultimo.modelo;
    if ((novo || null) !== (salvo || null)) await gravarAjuste(db, 'gemini-reserva', { modelo: novo, desde: new Date().toISOString() }).catch(() => {});
  }
  if (ultimo && !ultimo.erro && ERROS_QUE_TROCAM_DE_MODELO.has(ultimo.status) && ultimo.status !== 429) {
    const todos404 = demoradas === 0; // só 404: nenhum modelo liberado; senão é sobrecarga passageira
    return res.status(503).json({
      erro: todos404
        ? `Nenhum modelo do Gemini liberado para a chave respondeu (o Google tirou “${modelo}” do ar). Quem cuida do app precisa abrir Painel Admin → Chave e modelo, clicar em “Testar chave” e escolher outro modelo.`
        : 'O Google está sobrecarregado em todos os modelos disponíveis. Tentando de novo…',
      repetir: !todos404
    });
  }
  if (!ultimo) ultimo = { status: 503, erro: 'Nenhum modelo de IA disponível no momento. Tente de novo em alguns minutos.' };
  if (ultimo.erro) return res.status(ultimo.status).json({ erro: ultimo.erro, repetir: true });
  res.setHeader('X-Modelo', ultimo.modelo);
  res.status(ultimo.status).setHeader('Content-Type', 'application/json');
  return res.send(ultimo.texto);
}
