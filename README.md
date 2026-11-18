# ValidAI ISO 27001

Verificador de conformidade que avalia políticas e documentos de segurança contra os requisitos da ISO/IEC 27001 e 27002 usando o Google Gemini.

## O que faz

- Recebe um documento (PDF, DOCX ou TXT), extrai o texto no navegador e avalia cada requisito como *atende*, *atende em parte*, *não atende* ou *não se aplica*.
- Para cada requisito traz justificativa, trecho de evidência, o ponto exato do documento onde mexer e uma sugestão de texto.
- Cruza de 2 a 15 políticas entre si e aponta contradições, papéis e termos inconsistentes, referências quebradas, duplicações e lacunas.
- Mantém histórico compartilhado das análises e exporta resultados em CSV.
- Painel Admin para cadastrar as normas e configurar chave e modelo da IA.

## Destaques técnicos

- **Anti-alucinação**: o prompt exige evidência como cópia literal do documento, e o navegador confere se cada trecho existe de fato; o que não for encontrado aparece marcado como não confiável.
- **Saída estruturada**: respostas em JSON com `responseSchema` do Gemini, processadas em lotes de até 12 requisitos.
- **Resiliência**: em 404/429/500/503 troca automaticamente para outros modelos Flash disponíveis na chave, respeita prazos por tentativa e guarda o último modelo que funcionou.
- **Segredos só no servidor**: chave da IA e texto das normas nunca vão ao navegador; usuários comuns veem só id e título dos requisitos.
- **Endurecimento**: senha de admin comparada em tempo constante com atraso contra força bruta, CSP restritiva, `nosniff`, `no-referrer`, scripts de CDN com SRI.

## Stack

HTML/CSS/JavaScript puro (sem framework) · pdf.js e mammoth.js no navegador · Funções serverless da Vercel (Node) · Postgres (Neon) · Google Gemini API.

## Como rodar

```bash
npm install
cp .env.example .env     # preencha as variáveis
npx vercel dev           # serve index.html e as rotas /api
```

Variáveis: `DATABASE_URL`, `APP_SENHA` e, opcional, `GEMINI_API_KEY`. Depois de abrir o app, entre no Painel Admin, cadastre as normas e (se preferir) salve a chave do Gemini por lá. O texto das normas ISO não vem no repositório: cada instalação usa o seu.

## Estrutura

```
index.html          interface completa (análise, cruzamento, histórico, admin)
api/avaliar.js      avalia um lote de requisitos com o Gemini
api/cruzar.js       cruzamento de políticas por tema
api/normas.js       normas e requisitos (texto completo só para o admin)
api/config.js       chave e modelo do Gemini (só admin)
api/historico.js    histórico de análises; api/cruzamentos.js, de cruzamentos
api/_gemini.js      chamada ao Gemini com troca de modelo; api/_lib.js, banco e auth
```

## Direitos autorais

© 2026 Gustavo Fiedler Calegari. Todos os direitos reservados.

Este código está publicado apenas para avaliação de portfólio. Não é permitido copiar, modificar, distribuir ou usar comercialmente, no todo ou em parte, sem autorização por escrito do autor.
