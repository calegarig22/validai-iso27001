// Avalia um lote de requisitos com o Gemini.
// O navegador manda o documento e os códigos dos requisitos; o texto da norma e a chave ficam aqui.
// A conversa com o Google (e a troca de modelo quando ele falha) fica em _gemini.js.
import { rota, lerAjuste, metodoInvalido } from './_lib.js';
import { responderComGemini } from './_gemini.js';

const LIMITE_DOCUMENTO = 150000;
const MAX_POR_LOTE = 12;

const PROMPT_SISTEMA = `Você é um avaliador de conformidade de documentos com as normas ISO/IEC 27001 e ISO/IEC 27002.

REGRAS OBRIGATÓRIAS
1. Use EXCLUSIVAMENTE os trechos da norma fornecidos na mensagem como referência. Não use conhecimento externo sobre as normas, não complete requisitos de memória e não invente requisitos.
2. Avalie o DOCUMENTO em relação a cada trecho, de forma independente.
3. Valores permitidos para "status":
   - "atende": o documento cobre o que o trecho exige de forma clara e suficiente.
   - "parcial": o documento cobre só parte do que o trecho exige, ou de forma vaga.
   - "nao_atende": o requisito cabe a este tipo de documento, mas o documento não o cobre.
   - "nao_aplicavel": o requisito não cabe a este tipo de documento.
4. "evidencia": cópia LITERAL, caractere por caractere, de UM trecho contínuo do DOCUMENTO, com no máximo 300 caracteres, que comprove a avaliação. Nunca reescreva, resuma, traduza, corrija ou junte trechos separados, e nunca invente. Deixe "" quando o status for "nao_atende" ou "nao_aplicavel".
5. "local": onde mexer no DOCUMENTO para atender ao trecho, para a pessoa achar o ponto exato. Cópia LITERAL, caractere por caractere, de UM trecho contínuo do DOCUMENTO, com no máximo 200 caracteres (mesmas regras de cópia da "evidencia"). Em "parcial": a frase ou o parágrafo que precisa ser completado. Em "nao_atende": o título ou a frase da seção do documento mais ligada ao assunto, logo depois da qual o texto novo deve entrar; se nada no documento tratar do assunto, copie o título da seção onde o texto novo ficaria melhor (por exemplo, a seção de diretrizes, de responsabilidades ou de controles). Deixe "" somente quando o status for "atende" ou "nao_aplicavel".
6. "justificativa": 1 a 3 frases explicando o que o trecho da norma exige e o que o documento traz.
7. "sugestao": o que acrescentar ou ajustar no documento para atender ao trecho. Deixe "" quando o status for "atende" ou "nao_aplicavel".
8. Responda SOMENTE com JSON no formato {"resultados":[{"id":"T1","status":"atende|parcial|nao_atende|nao_aplicavel","justificativa":"","evidencia":"","local":"","sugestao":""}]}, com exatamente um item por trecho e usando o id informado (T1, T2, ...).
9. Escreva justificativa e sugestão em português do Brasil.`;

const ESQUEMA_RESPOSTA = {
  type: 'OBJECT',
  properties: {
    resultados: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          status: { type: 'STRING', enum: ['atende', 'parcial', 'nao_atende', 'nao_aplicavel'] },
          justificativa: { type: 'STRING' },
          evidencia: { type: 'STRING' },
          local: { type: 'STRING' },
          sugestao: { type: 'STRING' }
        },
        required: ['id', 'status', 'justificativa', 'evidencia', 'local', 'sugestao']
      }
    }
  },
  required: ['resultados']
};

// Guarda os requisitos na memória enquanto as normas não mudarem (evita baixar tudo a cada lote).
let cache = { atualizado: null, mapa: new Map() };
async function requisitos(db) {
  const [linha] = await db`SELECT atualizado FROM ajustes WHERE nome = 'requisitos'`;
  const versao = linha ? new Date(linha.atualizado).toISOString() : null;
  if (versao !== cache.atualizado) {
    const r = versao ? await lerAjuste(db, 'requisitos') : null;
    cache = { atualizado: versao, mapa: new Map((r?.reqs || []).map(x => [x.key, x])) };
  }
  return cache.mapa;
}

export default rota(async (req, res, db) => {
  if (req.method !== 'POST') return metodoInvalido(res, 'POST');
  const { documento, keys } = req.body || {};
  if (typeof documento !== 'string' || !documento.trim()) return res.status(400).json({ erro: 'Documento vazio.' });
  if (documento.length > LIMITE_DOCUMENTO) return res.status(413).json({ erro: 'O documento passa do limite de tamanho.' });
  if (!Array.isArray(keys) || !keys.length || keys.length > MAX_POR_LOTE) return res.status(400).json({ erro: 'Lote de requisitos inválido.' });

  const mapa = await requisitos(db);
  const reqs = keys.map(k => mapa.get(k));
  if (reqs.some(r => !r)) return res.status(409).json({ erro: 'As normas foram atualizadas no meio da análise. Recarregue a página e analise de novo.' });

  const trechos = reqs.map((r, i) => `[T${i + 1}] ${r.origem} — ${r.id} — ${r.titulo}\n${r.texto}`).join('\n\n---\n\n');
  const ids = reqs.map((_, i) => 'T' + (i + 1)).join(', ');
  const usuario = `DOCUMENTO A AVALIAR (entre <<<INICIO_DOCUMENTO>>> e <<<FIM_DOCUMENTO>>>):
<<<INICIO_DOCUMENTO>>>
${documento}
<<<FIM_DOCUMENTO>>>

TRECHOS DA NORMA (${reqs.length}):

${trechos}

Devolva exatamente ${reqs.length} itens em "resultados", com os ids ${ids}.`;

  return responderComGemini(db, res, { sistema: PROMPT_SISTEMA, usuario, esquema: ESQUEMA_RESPOSTA });
});
