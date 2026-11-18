// Cruza várias políticas entre si e devolve achados de um tema (contradições, papéis e termos,
// referências quebradas, duplicação e lacunas). O texto das políticas vem do navegador e não é guardado:
// só passa por aqui a caminho do Gemini.
import { rota, metodoInvalido } from './_lib.js';
import { responderComGemini } from './_gemini.js';

const LIMITE_DOCUMENTO = 150000;
const LIMITE_TOTAL = 400000;   // soma dos textos (cerca de 100 mil tokens)
const MIN_DOCS = 2;
const MAX_DOCS = 15;

const TEMAS = {
  contradicoes: {
    tipos: ['contradicao'],
    texto: `TEMA DESTA RODADA: CONTRADIÇÕES (tipo "contradicao").
Procure pontos em que duas ou mais políticas dizem coisas incompatíveis sobre o MESMO assunto: prazos, periodicidade de revisão, tempo de guarda ou retenção, regras de senha, níveis ou nomes de classificação da informação, o que é permitido ou proibido, quem aprova, valores e limites numéricos. Cite um trecho de CADA lado da contradição.`
  },
  papeis: {
    tipos: ['papel', 'termo'],
    texto: `TEMA DESTA RODADA: PAPÉIS E TERMOS (tipos "papel" e "termo").
- "papel": a mesma responsabilidade atribuída a papéis ou áreas diferentes em políticas diferentes; o mesmo papel com nomes diferentes (por exemplo, "CISO" em uma e "Gestor de Segurança da Informação" em outra) sem dizer que são o mesmo; papel citado que nenhuma política define.
- "termo": o mesmo termo definido de jeitos diferentes, ou termos diferentes usados para a mesma coisa de forma que gere dúvida.
Cite o trecho de cada política envolvida.`
  },
  referencias: {
    tipos: ['referencia'],
    texto: `TEMA DESTA RODADA: REFERÊNCIAS QUEBRADAS (tipo "referencia").
Procure remissões de uma política a outra política, procedimento, norma interna, anexo ou código de documento ("conforme a POL-X", "ver Procedimento de ...", "Anexo II") que: não estão no conjunto enviado; estão com nome, código ou versão diferente do documento que existe no conjunto; ou apontam para um documento do conjunto que não trata daquele assunto. Cite o trecho que faz a remissão. Quando o documento citado não estiver no conjunto, diga isso; não afirme que ele não existe na organização.`
  },
  duplicacao: {
    tipos: ['duplicacao', 'lacuna'],
    texto: `TEMA DESTA RODADA: DUPLICAÇÃO E LACUNAS (tipos "duplicacao" e "lacuna").
- "duplicacao": o mesmo tema regulado em duas ou mais políticas com textos próprios (mesmo que hoje não se contradigam), o que obriga a manter os dois atualizados. Não conte como duplicação a simples menção ou remissão a outra política.
- "lacuna": um assunto que uma política diz ser tratado em outra, mas nenhuma do conjunto trata; ou um processo ou responsabilidade que fica sem dono entre as políticas (cada uma supõe que a outra cuida).
Cite os trechos envolvidos.`
  }
};

const PROMPT_SISTEMA = `Você é um auditor de documentação de segurança da informação. Recebe um CONJUNTO de políticas de uma mesma organização e procura problemas ENTRE elas, para que a equipe corrija os documentos.

REGRAS OBRIGATÓRIAS
1. Use EXCLUSIVAMENTE o texto das políticas enviadas. Não use conhecimento externo sobre normas, não suponha o que a organização faz e não invente políticas, trechos ou regras.
2. Só registre um achado quando o texto mostrar o problema. Não registre diferenças só de redação, estilo ou formatação, nem pontos em que as políticas concordam.
3. Cada achado deve citar pelo menos um trecho em "trechos". "texto" é cópia LITERAL, caractere por caractere, de UM trecho contínuo da política indicada em "doc" (o código D1, D2, ...), com no máximo 300 caracteres. Nunca reescreva, resuma, corrija ou junte trechos separados.
4. "gravidade": "alta" quando as políticas dão regras incompatíveis ou deixam um controle sem responsável (risco real de descumprimento ou de apontamento em auditoria); "media" quando gera dúvida de interpretação ou retrabalho; "baixa" quando é questão de organização ou clareza.
5. "titulo": frase curta (até 12 palavras) que nomeia o problema.
6. "descricao": 1 a 3 frases dizendo o que cada política diz e por que isso é um problema.
7. "como_corrigir": ação concreta e prática. Diga qual política alterar, o que mudar e, quando for o caso, qual texto padronizar. Se a escolha entre as versões couber à gestão, diga isso e recomende uma opção. "corrigir_em": códigos (D1, D2, ...) das políticas que precisam ser alteradas.
8. No máximo 20 achados, os mais graves primeiro. Se não houver achados do tema, devolva "achados": [].
9. Responda SOMENTE com JSON no formato {"achados":[{"tipo":"","gravidade":"alta|media|baixa","titulo":"","descricao":"","trechos":[{"doc":"D1","texto":""}],"como_corrigir":"","corrigir_em":["D1"]}]}.
10. Escreva em português do Brasil.`;

function esquema(tipos) {
  return {
    type: 'OBJECT',
    properties: {
      achados: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            tipo: { type: 'STRING', enum: tipos },
            gravidade: { type: 'STRING', enum: ['alta', 'media', 'baixa'] },
            titulo: { type: 'STRING' },
            descricao: { type: 'STRING' },
            trechos: {
              type: 'ARRAY',
              items: { type: 'OBJECT', properties: { doc: { type: 'STRING' }, texto: { type: 'STRING' } }, required: ['doc', 'texto'] }
            },
            como_corrigir: { type: 'STRING' },
            corrigir_em: { type: 'ARRAY', items: { type: 'STRING' } }
          },
          required: ['tipo', 'gravidade', 'titulo', 'descricao', 'trechos', 'como_corrigir', 'corrigir_em']
        }
      }
    },
    required: ['achados']
  };
}

export default rota(async (req, res, db) => {
  if (req.method !== 'POST') return metodoInvalido(res, 'POST');
  const { documentos, tema } = req.body || {};
  const t = TEMAS[tema];
  if (!t) return res.status(400).json({ erro: 'Tema de cruzamento inválido.' });
  if (!Array.isArray(documentos) || documentos.length < MIN_DOCS || documentos.length > MAX_DOCS) {
    return res.status(400).json({ erro: `Envie de ${MIN_DOCS} a ${MAX_DOCS} políticas para cruzar.` });
  }
  if (documentos.some(d => typeof d?.nome !== 'string' || typeof d?.texto !== 'string' || !d.texto.trim())) {
    return res.status(400).json({ erro: 'Há uma política vazia ou em formato inválido.' });
  }
  if (documentos.some(d => d.texto.length > LIMITE_DOCUMENTO)) return res.status(413).json({ erro: 'Uma das políticas passa do limite de tamanho.' });
  if (documentos.reduce((n, d) => n + d.texto.length, 0) > LIMITE_TOTAL) return res.status(413).json({ erro: 'O conjunto de políticas passa do limite de tamanho.' });

  const blocos = documentos.map((d, i) =>
    `<<<INICIO_D${i + 1}>>> D${i + 1} — ${d.nome.slice(0, 200)}\n${d.texto}\n<<<FIM_D${i + 1}>>>`).join('\n\n');
  const usuario = `${t.texto}

POLÍTICAS DO CONJUNTO (${documentos.length}), cada uma entre <<<INICIO_Dn>>> e <<<FIM_Dn>>>:

${blocos}

Devolva os achados deste tema em "achados", usando os códigos D1 a D${documentos.length} em "doc" e "corrigir_em".`;

  return responderComGemini(db, res, { sistema: PROMPT_SISTEMA, usuario, esquema: esquema(t.tipos) });
});
