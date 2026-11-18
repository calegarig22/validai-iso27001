# Design system — ValidAI

Regra de ouro: **nunca escreva um valor solto; use o token** (variáveis CSS em `:root` no `index.html`).

## Tokens

| Grupo | Tokens |
|---|---|
| Tipografia | `--text-xs` 12 · `--text-sm` 14 · `--text-md` 16 · `--text-lg` 18 · `--text-xl` 20 · `--text-2xl` 24 · `--text-3xl` 30 · `--text-4xl` 36 |
| Espaçamento | `--space-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 24 · `-6` 32 · `-7` 48 · `-8` 64 |
| Raio | `--radius-sm` 6 · `--radius-md` 10 · `--radius-lg` 14 · `--radius-full` |
| Sombra | `--shadow-sm` (cartões) · `--shadow-md` (destaques) · `--shadow-lg` (gaveta, avisos) |
| Movimento | `--duration-fast` 120ms · `--duration-base` 200ms · `--ease-standard` (respeita “reduzir movimento”) |

## Cores semânticas (claro e escuro)

`--bg`, `--surface`, `--surface-2/3`, `--border`, `--border-strong`, `--text`, `--text-muted`,
`--primary` / `--primary-hover` / `--primary-fg` / `--primary-soft`, `--ring` (foco).
Situações: `--success` (Atende), `--warning` (Em parte), `--danger` (Não atende), `--neutral` (Não se aplica), `--violet` (Sem resposta), cada uma com `-soft` para fundos.
Menu lateral: `--side-*`. Pares de texto/fundo verificados para contraste WCAG AA.

## Componentes

- **Botão** `.btn` + `.btn-primary` (ação principal, 1 por área) · `.btn-secondary` (ações de apoio) · `.btn-ghost` (ações discretas) · `.btn-danger` (remover/apagar). Tamanhos `.btn-sm` / `.btn-lg`. Alvo mínimo de 44px em telas de toque.
- **Campo** `.input` dentro de `.field` com `.field-label` e `.hint`. `.input-group` junta campo + botão.
- **Cartão** `.card` com `.card-head` (ícone `.card-icon`, título, descrição).
- **Mensagem** `.msg` + `erro` / `aviso` / `info` / `ok`. **Aviso rápido** `toast()` para confirmações.
- **Pílula** `.pill` (+ `-ok`, `-info`, `-aviso`); **selo de situação** `.selo s-<situação>`.
- **Área de arrastar** `.dropzone`; **abas** `.tabs` (setas do teclado); **segmentado** `.segmented`; **cartão de opção** `.option-card`.
- **Indicadores** `.stats/.stat`, `.anel` (percentual), `.barra` (distribuição), `.filtro` (filtro por situação).

## Telas

Menu lateral com Início, Configurações (1), Normas (2), Documento (3), Análise (4), Resultado e Histórico. Navegação por endereço (`#/normas` etc.), foco no título ao trocar de tela, menu vira gaveta abaixo de 960px e a tabela vira cartões abaixo de 760px.
