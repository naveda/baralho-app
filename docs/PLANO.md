# Plano — `baralho-app`: cartas de citações políticas com fonte na cara

> **Status:** **estúdio de impressão implementado e verificado** (§8); o modo de
> jogo (mesa, virar carta, rodada) e o painel de triagem seguem pendentes.
> **Entrada de referência:** `Baralho (1).pdf` (Google Drive / "Saved from Chrome").
> **Saída pretendida:** app web mobile-first, zero dependências, PT-BR, com
> baralho filtrável por tema, carta que vira (frente = citação; verso = autor +
> data + link + QR code da fonte).

---

## 0. O que é (e o que não é)

**É:** um jogo de cartas de uma por vez. O usuário escolhe um tema, embaralha,
lê a citação **sem saber quem disse**, julga ("isso é bom ou ruim?") e só então
vira a carta para ver autor, data, link oficial e QR code.

**Não é:** gerador de acusações. **Regra dura de produto:** só entra no app
público a carta com `status: "approved"`, com `link` de fonte primária e
revisor humano registrado. Citação sem fonte verificada não é exibida (ou
aparece apenas em modo interno com tarja "NÃO VERIFICADO").

O loop do PDF já resolve o viés mais forte (julgar sem saber o dono da frase).
O app acrescenta tema, embaralhamento, fonte clicável e QR — e mantém tudo
local, sem servidor e sem coleta de dados.

---

## 1. Research

### 1.1 O baralho real (inventário do PDF)

Extraído com `pdfinfo` + `pdftotext -layout` + render `pdftoppm`:

- 9 páginas A4 paisagem, Word 2007 → PDF, criado 25/08/2026, modificado 08/09/2026.
- **32 cartas**, frente = *"Isso é bom ou ruim?"* + citação numerada + hashtag de tema;
  verso = **apenas o nome** do político.
- Cartas **1–16 → LULA** (propostas/programa). Cartas **17–32 → FLÁVIO BOLSONARO**.
- Temas no baralho: economia, direitos trabalhistas, segurança, educação,
  reforma tributária, soberania, programas sociais, saúde, defesa da mulher,
  meio ambiente, democracia, privatização, estado mínimo, diversidade, corrupção.
  **Não há tema de arte/cultura** — a taxonomia do app será extensível e incluirá `cultura`.
- Design tokens: carta branca, borda preta fina, cantos ~8 px, naipe no canto
  (♥ vermelho na 1ª metade, ♠ preto na 2ª), citação em serifada itálica com aspas
  curvas, hashtag pequena, pergunta em vermelho, índice espelhado no canto inferior.
- Há QR code na p. 9 ("Compartilhe!") apontando para o próprio arquivo do jogo.
  **Não decodificado** (sem `zbarimg`/`pyzbar`/`cv2` na máquina) — item aberto (§7).

**Inventário completo:** `baralho-app/data/cards.seed.json` (32 cartas, todas `wait`).

> **Nota de honestidade:** o baralho é material partidário — as citações "ruins"
> são todas de um campo, as "boas" do campo oposto, e as cartas 1–16 são na
> verdade **itens de programa**, não frases literais. O schema do app é neutro
> (aceita qualquer político/tema); a curadoria e a checagem de atribuição são
> obrigatórias (§3.4 e §6).

### 1.2 Research web

Contexto: eleição presidencial brasileira de **2026** (Lula × Flávio Bolsonaro).
O baralho tem lastro em fatos de 2026 — tarifaço dos EUA, anistia aos golpistas
do 8/1, "tesouraço", fim da escala 6×1.

Fontes candidatas a `link`:

| Tipo | Fonte |
|---|---|
| Programa/propostas do candidato | [lula.com.br/propostas](https://lula.com.br/propostas/) (oficial de campanha) |
| Resumo oficial partidário | [pt.org.br — propostas de Lula](https://pt.org.br/conheca-as-propostas-e-os-compromissos-de-lula-com-o-brasil-e-os-brasileiros/) (15/09/2026) |
| Registro de candidatura / plano de governo | TSE — DivulgaCandContas |
| Fala em sabatina/entrevista | vídeo oficial (canal do candidato) + transcrição; noticiário como secundária |
| Atos de governo / votações | Planalto/Casa Civil, Câmara, Senado |
| Fala de Flávio (exemplo real) | [VTV News — "Vou trabalhar para que a anistia seja feita"](https://vtvnews.com.br/noticias/eleicoes/vou-trabalhar-para-que-a-anistia-seja-feita-diz-flavio-bolsonaro-b/) |

Regras de fonte: **primária > secundária**; toda carta guarda também `arquivo`
(snapshot no web.archive.org ou PDF baixado), porque link de ano eleitoral quebra.

Decisões técnicas de apoio:

- **Zero dependências** (padrão dos apps irmãos `escrita-app`, `kanban-app`,
  `workbench-app`): Node ≥ 18 (`node:http`, sem `npm install`) + SPA vanilla.
- **Flip 3D**: `transform-style: preserve-3d` + `rotateY(180deg)` com fallback
  em `prefers-reduced-motion` — ver [Flip It Like a Pro](https://hashnode.com/posts/flip-it-like-a-pro-css3-rotating-cards-made-easy).
- **QR code gerado no cliente, offline**: gerador MIT vendorizado (candidato:
  biblioteca de Nayuki, ~1 arquivo JS, QR v1–40 → SVG). Alternativas npm
  (`qrcode`, `modqr`) quebrariam a regra de zero-dep. O QR aponta para a **mesma
  URL canônica** do `link` da carta — nunca para encurtador nosso.
- **Persistência**: `localStorage` apenas (sem backend/DB na v1).

### 1.3 O que muda a tendência (decisões de produto)

1. Julgar **antes** de saber quem disse — já é o mecanismo do PDF, mantido.
2. Pergunta explícita **antes/depois**: "mudou sua opinião? sim/não", guardada
   **só no aparelho** → mede efeito sem servidor e sem LGPD.
3. Uma carta por vez, ordem embaralhada, tema escolhido pelo usuário → agência,
   menos sensação de panfleto.
4. A fonte aparece **antes** de qualquer botão de compartilhar (credibilidade e
   responsabilidade: não fabricar boato fora de contexto).
5. Sem ranking de "acertos" que gamifique convicção.

---

## 2. Sistema de interações

### 2.1 Telas

1. **Início / Temas** — título, busca, chips de tema (Todos, Economia, Social,
   Saúde, Trabalho, Educação, Segurança, Diversidade, Meio ambiente…),
   botão **"Embaralhar e jogar"**, contador "N cartas verificadas de M".
2. **Mesa** — uma carta em perspectiva 3D. Frente: *"Isso é bom ou ruim?"* +
   citação + tema + **data** (ou "data não confirmada") + número.
   Rodapé: 👍 Isso é bom · 👎 Isso é ruim · Passar.
3. **Verso (revelação)** — autor, cargo/partido, data, **link clicável**
   ("Fonte oficial ↗"), **QR code**, selo "verificada", botões
   "Próxima carta" e "Compartilhar".
4. **Fim da rodada** — resumo local (cartas vistas, quantas "mudei de ideia"),
   recomeçar. Sem ranking, sem envio.
5. **Admin / Contribuidor (protegida)** — formulário "adicionar citação",
   fila de triagem (aprovar · aguardar · rejeitar), importar/exportar JSON e CSV.

### 2.2 Máquina de estados da carta

```
idle → drawn (frente, citação visível)
     → judged (opcional: bom/ruim)
     → flipped (verso: autor + data + link + QR)
     → next | shared
```

Regras:

- O autor **não existe no DOM** antes do flip → inspecionar o código não "cola" a resposta.
- Flip só habilita após ~400 ms com a carta visível (evita revelar por toque acidental no celular).
- Botão voltar do navegador navega entre estados (`history.pushState`): voltar = desvirar, não sair.
- **Teclado**: `Espaço/Enter` virar · `←/→` anterior/próxima · `B`/`N` bom/ruim · `Esc` voltar à mesa. Foco sempre visível.
- **Acessibilidade**: frente/verso com `aria-hidden` gerenciado; leitor de tela lê
  "Carta 7 de 32, frente: citação"; o **link é o caminho acessível principal** e o
  QR é atalho (tem `aria-label`), nunca o único acesso.
- **Mobile**: tap vira, swipe horizontal avança; nada dependente de `hover`.
- `prefers-reduced-motion`: sem rotação 3D, crossfade de 120 ms.

### 2.3 Seleção e embaralhamento

- Filtro por tema → elegíveis **apenas `status: "approved"`** → Fisher–Yates com
  seed opcional (`?seed=abc`) para reproduzir uma rodada/print.
- Sem repetição na rodada; "modo infinito" reembaralha ao esgotar.
- Peso por `relevance` **desligado por padrão** (não distorcer a amostra).
- Modo rascunho local `?draft=1`: exibe cartas `wait` com tarja
  "NÃO VERIFICADO", só em desenvolvimento — **nunca no build público**.

### 2.4 Compartilhamento

- "Compartilhar" gera PNG da carta **com autor + fonte** (canvas) e/ou o link
  canônico `/#/carta/C07`. **Nunca** compartilhar a frente isolada.
- Open Graph por carta (citação + autor + fonte) e metadados por tema.

---

## 3. Dataset

### 3.1 Schema

Campos pedidos + os que a operação exige. Fonte de verdade: `data/cards.json`.

| Campo | Tipo | Regra |
|---|---|---|
| `id` | string | `C01`…, único |
| `quote` | string | 10–600 chars, **texto literal**, sem edição |
| `link` | url \| null | **obrigatório se `approved`**; fonte primária/oficial |
| `topic` | enum | taxonomia canônica (§3.2) |
| `status` | enum | `approved` \| `wait` \| `reject` |
| `contributor` | string | quem cadastrou (`nome` ou `import:...`) |
| `relevance` | int 1–5 | centralidade/impacto do tema no debate |
| `autor`, `autorId`, `cargo`, `partido` | string | quem disse |
| `data`, `dataPrecisao` | ISO \| null, enum | `exata` \| `dia` \| `mes` \| `ano` \| `desconhecida` |
| `veiculo` | string | onde foi dito (sabatina, rede social, programa) |
| `arquivo` | url \| null | snapshot (web.archive.org/PDF) |
| `tagsOriginais` | string[] | hashtags do baralho de origem |
| `numeroNaCarta` | int \| null | posição no PDF original (rastreabilidade) |
| `criadoEm`, `revisadoPor`, `revisadoEm`, `motivoRejeicao`, `observacao` | string | trilha de auditoria |

**Validações duras** (no build, falham o processo):

1. `approved` exige `link` + `autor` + (`data` ou `dataPrecisao` ≠ `desconhecida`).
2. `approved` exige `revisadoPor` e `arquivo` (snapshot).
3. `wait`/`reject` **nunca** entram no bundle público.
4. `link` não pode ser encurtador nem rede social como fonte única.
5. Uma carta = uma citação; paráfrase não pode ser apresentada como citação literal.
6. Atribuição incerta → `wait` + `observacao`.

### 3.2 Taxonomia de temas (`data/topics.json`)

`economia · tributos · trabalho · educacao · saude · seguranca ·
assistencia-social · mulheres · meio-ambiente · democracia · diversidade ·
soberania · estado-minimo · privatizacao · corrupcao · cultura`

Cada tema tem `slug`, `label` PT-BR, emoji e `sinonimos` (mapeando as hashtags do
PDF: `#direitostrabalhistas → trabalho`, `#programassociais → assistencia-social`,
`#defesadamulher → mulheres`, `#reformatributaria → tributos`, `#privatizacao → privatizacao`,
`#estadominimo → estado-minimo`, `#diversidade → diversidade`).

### 3.3 Exemplo de registro

```json
{
  "id": "C22",
  "quote": "Defender anistia para os golpistas.",
  "link": null,
  "topic": "democracia",
  "status": "wait",
  "contributor": "import:baralho-pdf",
  "relevance": 5,
  "autor": "Flávio Bolsonaro",
  "autorId": "flavio-bolsonaro",
  "cargo": "Senador da República (RJ) — candidato à Presidência em 2026",
  "partido": "PL",
  "data": null,
  "dataPrecisao": "desconhecida",
  "observacao": "Item de programa/afirmação atribuída. Exige vídeo ou transcrição antes de aprovar."
}
```

### 3.4 Ingestão e triagem

- **Entrada**: painel admin (form + colar link), import CSV/JSON, e este
  `cards.seed.json` (32 cartas do PDF, todas `wait`).
- **Fluxo**: `wait` → triagem humana → `approved` **ou** `reject` (com motivo).
  Toda mudança grava `revisadoPor` + `revisadoEm`.
- **Deduplicação**: hash normalizado de `quote` + `autor`.
- **Build**: `node tools/build-data.mjs` valida e gera
  `web/public/data/cards.json` **só com `approved`** + relatório do que ficou de fora.

### 3.5 QR

Gerado no cliente a partir de `link` (correção de erro M, quiet zone 4, SVG nítido
e leve). Sem `link`, a carta não entra no modo público — logo não há QR órfão.

---

## 4. Arquitetura

```
baralho-app/
├── data/
│   ├── cards.seed.json      # 32 cartas extraídas do PDF (todas wait)  ← JÁ EXISTE
│   ├── cards.json           # fonte de verdade (approved/wait/reject)
│   └── topics.json          # taxonomia
├── tools/
│   ├── validate.mjs         # schema + regras duras
│   └── build-data.mjs       # data/ → web/public/data (só approved)
├── lib/
│   ├── deck.mjs             # filtro, Fisher–Yates com seed, seleção (puro)
│   ├── qr.mjs               # QR → SVG (MIT vendorizado)
│   └── store.mjs            # localStorage: julgamentos, rodada, "apagar meus dados"
├── web/
│   ├── server.mjs           # node:http, estático, porta 4178
│   └── public/
│       ├── index.html
│       ├── app.js           # máquina de estados + render + rota por hash
│       ├── card.css         # carta 3D, flip, temas, print
│       └── data/cards.json  # gerado
├── test/smoke.mjs           # deck, shuffle, validação, estados, QR
└── docs/PLANO.md            # este documento
```

Porta **4178** (4177 = `workbench-app`). Rodar: `node baralho-app/web/server.mjs`.
Zero dependências; PT-BR; mobile-first; offline; sem backend na v1.

---

## 5. Roadmap e critérios de aceite

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **1. Dados** | `cards.seed.json` (32) + `topics.json` + `validate.mjs` | `node tools/validate.mjs` passa com 32 cartas `wait` |
| **2. Mesa** | SPA: temas, shuffle, carta 3D, flip, teclado, a11y | clicar vira; autor só aparece no verso; a11y Lighthouse ≥ 95 |
| **3. Fonte** | QR SVG offline + link + data + copiar/compartilhar | QR lido no celular abre exatamente o `link`; `?seed` reproduz a rodada |
| **4. Triagem** | admin: adicionar/editar, aprovar/aguardar/rejeitar, import/export; build só `approved` | `wait`/`reject` nunca no bundle; build falha se entrarem |
| **5. Curadoria** | 15–25 cartas verificadas (fonte primária + snapshot + revisor) | 100% das `approved` com link + snapshot + revisor |
| **6. Polimento** | PWA-lite, OG por carta, imagem compartilhável, "modo 1 minuto" | teste em iOS e Android reais |

Fases 1–3 são desenvolvidas e demonstradas em `?draft=1` (tarja NÃO VERIFICADO);
o app só vai a público depois da Fase 5.

---

## 6. Riscos e conformidade

- **Atribuição (risco #1).** Atribuir a alguém real algo que não disse é
  difamação. Mitigação: link + snapshot + revisor humano por carta; `approved`
  só com evidência; nada não verificado sem tarja.
- **Eleitoral (Brasil 2026).** Propaganda na internet tem regras: restrições a
  impulsionamento pago e a conteúdo sabidamente falso/odioso, com remoção rápida
  exigida pela Justiça Eleitoral. Recomendo revisão jurídica antes de publicar ou
  anunciar. Manter identificação de origem do material.
- **LGPD.** Opinião política e tendência de voto são **dados sensíveis** (art. 5º, II).
  Mitigação: tudo em `localStorage`; sem analytics, sem cookies de terceiros, sem
  servidor; botão "apagar meus dados".
- **Manipulação.** O app é persuasivo por design (objetivo declarado). Contrapeso
  mínimo: citação literal, fonte e data visíveis antes do compartilhamento, QR e
  link sempre no verso — o usuário pode conferir na hora.
- **Neutralidade do código.** Schema e taxonomia servem a qualquer político de
  qualquer campo; o conteúdo é responsabilidade de quem cura.

---

## 7. Decisões abertas (preciso do seu OK)

1. **Escopo da v1:** só as 32 cartas do PDF, ou já abrir para vários políticos?
2. **Idioma:** PT-BR apenas?
3. **Distribuição:** uso local/QR (imprimir e jogar) ou publicado na internet?
   Isso muda o pacote de conformidade eleitoral (§6).
4. **Hospedagem** se público: estático (Vercel/Netlify) ou app standalone do DSH?
5. **Nome do app:** "Baralho" · "Isso é bom ou ruim?" · "Carta na Mesa" · outro?
6. **QR do PDF (p. 9):** quer que eu decodifique para achar a fonte original do
   baralho? (precisa instalar `zbar` ou usar leitor no celular)

---

## 8. Implementado: estúdio de impressão

Pedido do usuário: *"faça um sistema para poder imprimir as cartas caso o usuário
queira"*. Entregue em `web/public/print.html` (+ `print.css`, `print.js`).

**Por que impressão importa para este produto:** o baralho de referência é
print-and-play, e a frente sozinha não serve para nada — é o verso com a fonte
que sustenta a informação. Logo o sistema de impressão tem que garantir que
**frente e verso caiam um atrás do outro**, com o QR legível no papel.

**O que ele faz**

- Folhas em tamanho real (mm) com pré-visualização fiel; A4/Letter, paisagem ou
  retrato; 4/6/8/9 cartas por folha; tamanho automático ou pôquer/bridge/mini;
  margem, espaçamento e linha de corte configuráveis.
- Quatro modos: **duplex**, **somente frentes**, **somente versos** (para
  impressão manual em duas passagens) e **recortar e colar** (sem duplex).
- **Espelhamento correto do verso:** borda longa inverte as linhas, borda curta
  inverte as colunas; slots vazios da última folha ficam na mesma posição física.
- **Teste de alinhamento** em duas folhas (botão e `/print.html?teste=1`), com as
  posições numeradas e espelhadas como na impressão real.
- Rodapé por folha ("frente/verso · folha n/total") para não embaralhar a tiragem.
- QR e/ou link por extenso no verso; data formatada conforme `dataPrecisao`
  (`2026-10` nunca vira `01/10/2026`).
- Selo de rascunho: tarja "não verificado" no canto da frente e faixa vermelha no
  verso; desligar gera aviso em vermelho.

**Decisão de integridade visual:** os símbolos da frente são **uniformes** por
padrão. O PDF d'origem usa ♥ na primeira metade e ♠ na segunda — o que entrega
que as cartas 1–16 são de um político e 17–32 de outro. Como a frente não pode
conter nenhuma pista do autor, a opção "um símbolo por tema" existe mas não é o
padrão (e temas com cartas de um só autor ainda vazariam).

**Verificação executada**

| Prova | Resultado |
|---|---|
| Encoder de QR vs. biblioteca de referência, máscara a máscara (v1–40 × L/M/Q/H) | 536 matrizes, **0 divergências** |
| Escolha automática de máscara vs. referência | **67/67** |
| Decodificação por leitor independente (`jsqr`) | **67/67** |
| PDF impresso pelo Chrome headless: página, grade, espelhamento | 8 páginas A4 paisagem; frente 1–8 e verso 5–8/1–4 |
| **QR lido do PDF rasterizado a 300 dpi** por leitor independente | 2/2, inclusive URL de snapshot longa |
| `test/smoke.mjs` (dados, baralho, QR, servidor, travessia de caminho) | **482 verificações**, todas passando |

**Ferramentas criadas:** `tools/gen-qr-tables.mjs` (gera as tabelas da norma a
partir da referência, com validação das invariantes) e `tools/verify-qr.mjs`
(verificação independente). Comandos no `README.md`.

**Modo rascunho é o estado atual:** como nenhuma das 32 cartas tem fonte
primária anexada, toda tiragem sai com selo de não verificada. Isso é
intencional: o sistema se recusa a produzir material distribuível sem fonte.
Assim que a curadoria (§5, Fase 5) aprovar cartas com `link` + snapshot, a
impressão passa a sair limpa automaticamente.

---

## 9. Implementado: tópicos próprios do usuário

Pedido do usuário: *"o usuário também pode fazer uma seleção dos cards com um
tópico próprio renomeado"*. Entregue em `web/public/topicos.html`
(+ `topicos.css`, `topicos.js`), com a lógica pura em `lib/topics.mjs` e a
persistência em `lib/store.mjs`.

**Modelo:** uma **camada por cima** da taxonomia base, não uma cópia dela.

```
overlay = {
  renomeados:  { "economia": { label: "Dinheiro do povo", slug: "dinheiro" } },
  proprios:    [ { id: "t1", label: "Arte e educação", slug: "arte-e-educacao", simbolo: "◆", cor: "preto" } ],
  atribuicoes: { "C01": "t1", "C07": "saude" }
}
```

A carta aponta para uma **chave**: o slug da base (`economia`) ou o id de um
tópico próprio (`t1`). O id é estável, então renomear não quebra atribuições.
Resolução: `atribuição explícita > tema da base (com renomeação)`.

**Por que uma camada e não editar os dados:** o `cards.seed.json` é registro de
pesquisa e `cards.json` será conteúdo curado — nenhum dos dois deve mudar porque
o usuário preferiu chamar "economia" de "dinheiro". A camada é reversível
("voltar à taxonomia original"), exportável em `.json` e não sai do aparelho.

**Decisão de UX:** nome e etiqueta `#` são **dois campos separados** na mesma
linha. O nome é o que aparece no app (chips, filtros, listas); a etiqueta é o que
sai impresso na frente da carta. Assim o usuário tem controle total sem que a
renomeação de um rótulo mude silenciosamente o que está no papel.

**Consequências no resto do app:** os chips do estúdio de impressão, o filtro por
tema, o símbolo da carta e a etiqueta `#` da frente passam a usar o tópico
efetivo; o verso mostra `#slug · Nome` quando diferem. Tópicos próprios ganham
marcação visual própria (dourada) para não se confundirem com a taxonomia.

**Verificação**

| Prova | Resultado |
|---|---|
| `test/smoke.mjs` — renomear, criar, atribuir, sanitizar lixo, exportar/importar, `localStorage` corrompido, rotas novas | **526 verificações**, todas passando |
| `tools/verify-topicos.mjs` — fluxo real no Chrome (Playwright): cria tópico, renomeia tema, atribui 3 cartas em massa e confere a impressão | **20 verificações**, incluindo "nenhum erro de JavaScript" |
| Impressão duplex depois da integração | 8 páginas A4 paisagem, inalterado |

Também corrigido na mesma rodada: os botões `.btn--ghost` estavam com texto claro
(herdado da barra escura) e ficavam ilegíveis no painel claro — agora são neutros
por padrão e a barra escura sobrescreve. E a página ganhou favicon.

---

## 10. Implementado: celular e créditos

### 10.1 Celular

Pedido do usuário: *"o webapp deve ser adaptado para celular"*. Não foi só
encolher o layout — em viewport de 390 px o painel de 330 px empurrava a prévia
para fora da tela.

- **Abas Ajustes / Prévia** no estúdio (`≤ 860 px`), com a barra de abas grudada
  logo abaixo do topo (a altura da barra é medida por `ResizeObserver` e vira a
  variável `--topbar-h`, para não depender de um número mágico).
- **Barra fixa no rodapé** com resumo da tiragem e a ação principal, respeitando
  `env(safe-area-inset-bottom)`.
- **Ajuste automático de escala** para a folha caber na largura, com
  arredondamento **para baixo** — arredondar para cima fazia a folha estourar 3 px
  e criar rolagem lateral.
- **Alvos de toque ~44 px**, campos com fonte de 16 px (o iOS dá zoom automático
  abaixo disso) e botões de desktop escondidos.
- **Meus tópicos**: linhas viram cartões empilhados e o grupo de atribuição vira
  **barra fixa** quando há cartas marcadas (`body.tem-selecao`).
- **Instalável**: `manifest.webmanifest`, ícones 192/512/maskable gerados por
  `tools/gerar-icones.py`, `theme-color` e `apple-touch-icon`.

**Regressão que apareceu no caminho (e que valeu o teste):** com a aba "Ajustes"
ativa, a prévia fica `display:none` — e imprimir dali saía **em branco**. O
bloco `@media print` agora força a prévia a aparecer qualquer que seja a aba, e
`tools/verify-mobile.mjs` reproduz exatamente a combinação (viewport estreito +
aba Ajustes + mídia de impressão) para não voltar.

### 10.2 Créditos

Pedido do usuário: *"deve conter uma seção de créditos"*.

Conteúdo em **dado**, não código: `data/creditos.json` → `/api/creditos` →
`/creditos.html`, com uma versão resumida na página inicial. Para mudar nomes,
papéis, links ou textos, edita-se o JSON.

Blocos: concepção e desenvolvimento (Luiz Naveda, UEMG/PPG Artes, com Lattes e
ORCID, e a assistência de implementação declarada), baralho de referência (com a
ressalva de que a autoria aparece só como "Regiane" nos metadados e a licença de
reuso **não foi confirmada**), fontes das citações, software de terceiros com as
licenças (`qrcode` MIT, `jsqr` Apache-2.0, `playwright-core` Apache-2.0), dados e
privacidade (LGPD), aviso e citação recomendada.

A ressalva sobre a autoria do baralho de origem não é formalidade: sem ela, o
crédito a "Regiane" seria uma afirmação mais forte do que o arquivo permite.

**Verificação**

| Prova | Resultado |
|---|---|
| `test/smoke.mjs` — créditos (blocos, ressalva, licenças, citação, LGPD), manifesto e ícones declarados que existem de fato, rotas novas | **567 verificações**, todas passando |
| `tools/verify-mobile.mjs` — iPhone 13 emulado nas quatro páginas | **41 verificações**, incluindo a regressão de impressão em branco |
| Impressão duplex no desktop, depois de tudo | 8 páginas A4 paisagem |
| Créditos impressos (`/creditos.html`) | 3 páginas, com os links por extenso |

---

## 11. Implementado: o jogo

Era o pedido original (§0) e ficou para trás enquanto impressão, tópicos e
créditos foram construídos. O usuário cobrou — *"onde está o jogo"* — com razão.
Entregue em `web/public/jogo.html` (+ `jogo.css`, `jogo.js`), com as regras puras
em `lib/jogo.mjs` e o placar em `lib/store.mjs`.

**O loop, em dois momentos** (idêntico ao que o baralho de referência descreve na
página "Importante"): aparece a citação **sem autor**; a pessoa julga bom/ruim;
**só então** a carta vira e mostra autor, cargo, data, tema, link e QR. Quem não
quer opinar usa "só revelar". Depois de revelar, se houve julgamento, o jogo
pergunta se a pessoa mudou de opinião ao saber quem disse.

**A garantia que dá sentido ao jogo:** o nome do autor **não existe no DOM antes
de virar**. O verso é montado na revelação e limpo ao trocar de carta. Se isso
quebrar, o jogo perde a graça — então há teste dedicado:

```js
const htmlAntes = await pagina.content();
ok(autores.every((a) => !htmlAntes.includes(a)), 'nenhum nome de autor no HTML antes de virar');
```

**Decisões de operação**

- **Estado em módulo puro** (`lib/jogo.mjs`): rodada, sessão, julgamentos,
  revelações, mudanças e resumo são funções sem DOM, testáveis no Node. O
  `jogo.js` só desenha e trata eventos.
- **Fonte de cartas a mesma da impressão**: `/api/cards` + overlay de tópicos, com
  o mesmo portão de rascunho. O jogo nunca mostra uma carta que a impressão
  recusaria — e marca as não verificadas.
- **Volta mostra o verso**: retornar a uma carta já revelada reaparece revelada,
  sem animação (`requestAnimationFrame` + classe `.sem-animacao`). Reexibir a
  frente ao voltar era confuso e desfazia o que a pessoa já tinha visto.
- **Seed reproduzível**: `?seed=turma-a` repete a mesma ordem — útil para aplicar
  a mesma rodada em várias pessoas.
- **Placar local** com botão de apagar; nada sai do aparelho.

**Verificação**

| Prova | Resultado |
|---|---|
| `test/smoke.mjs` — regras do jogo (rodada, julgar, revelar, mudar, avançar/voltar, resumo, placar, JSON corrompido) | **623 verificações**, todas passando |
| `tools/verify-jogo.mjs` — dois servidores próprios (com e sem fonte), fluxo completo, teclado, placar, celular | **38 verificações** |
| `tools/verify-mobile.mjs` — jogo em iPhone 13 emulado | **48 verificações** |
| Impressão duplex depois de tudo | 8 páginas A4 paisagem |

Corrigido de passagem: o link da fonte quebrava no meio de palavras na carta
(`word-break: break-all`), partindo "propostas/" em "propost/as/". Agora usa só
`overflow-wrap: anywhere`, que quebra onde couber sem picar a palavra à toa.
