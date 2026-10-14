# AGENTS.md — guia para agentes de código

Este arquivo é para quem vai **mexer** no projeto (agente ou pessoa). Ele diz o que
não pode quebrar, como rodar, onde as coisas ficam e quais armadilhas já custaram
tempo aqui. Leia antes de editar.

---

## 1. O que é este projeto

Um **baralho de citações políticas com fonte**, jogado entre pessoas. A frente da
carta traz uma frase; quem virou descobre quem disse e de onde veio, com link e QR
code para a fonte. Não é peça de campanha: é ferramenta de leitura e debate.

Três coisas definem o produto:

1. **A fonte é o ponto.** Uma carta sem fonte anexada não circula.
2. **A autoria só aparece depois de virar.** Antes disso, o nome não existe no DOM.
3. **Nada de métrica.** Não há placar, nem julgamento automático. O jogo acontece
   entre as pessoas, ao vivo.

Stack: **Node ≥ 18 e navegador, zero dependências em runtime**. Sem build, sem
bundler, sem framework. O Playwright só existe para os verificadores.

---

## 2. Regras que não podem quebrar

Cada uma destas tem teste. Se você quebrar, a suíte acusa — então rode a suíte
antes de commitar.

| invariante | onde vive | por quê |
|---|---|---|
| Nome do autor **não existe no DOM** antes de virar (nem no `aria-label`, nem o da carta anterior) | `web/public/jogo.js` (`limparVerso`, `montarVerso`) | o baralho perde a graça se a resposta vaza |
| Só carta `approved` sai em `/api/cards` (sem `draft=1`) | `web/server.mjs` | nada não revisado chega ao público |
| Aprovar exige fonte anexada | `server.mjs`, `tools/cards-csv.mjs`, `triagem.js` | acusação sem fonte não circula |
| Rejeitar exige motivo | idem | a decisão precisa ser auditável |
| Toda revisão guarda revisor e data | `data/curadoria.json` | sem autoria não é revisão |
| **`data/cards.csv` é a fonte das cartas**; `cards.seed.json` é gerado | `tools/cards-csv.mjs` | a pesquisa é editada em planilha |
| O seed **nunca é reescrito** pela curadoria | `data/curadoria.json` é separado | preserva a procedência |
| Toda carta da mesa é **alcançável** (tem um pedaço próprio para o dedo) | `posicoesEspalhadas` em `jogo.js` | carta escondida não dá para escolher |
| O QR decodifica em leitor independente | `lib/qr.mjs` | é o que leva à fonte no papel |

As regras valem em **três pontas** — planilha, servidor e tela — porque uma não
pode confiar na outra. Se mudar uma, mude as três e ajuste o teste.

---

## 3. Rodar

```bash
node web/server.mjs              # http://127.0.0.1:4178
BARALHO_PORT=4180 node web/server.mjs
BARALHO_DATA=cards.demo.json node web/server.mjs   # fixture de teste
```

| variável | efeito |
|---|---|
| `BARALHO_PORT` | porta (padrão 4178) |
| `BARALHO_HOST` | interface (padrão 127.0.0.1) |
| `BARALHO_DATA` | força um arquivo de `data/` (fixtures dos testes) |
| `BARALHO_CURADORIA` | força o arquivo de revisão (testes usam descartáveis) |

Páginas: `/` (início) · `/jogo.html` · `/print.html` · `/topicos.html` ·
`/fontes.html` · `/creditos.html` · `/triagem.html`.

---

## 4. Testar

```bash
node test/smoke.mjs                        # 970 verificações, zero dependências
node tools/verify-qr.mjs      /tmp/qrverify
node tools/verify-jogo.mjs    /tmp/qrverify
node tools/verify-triagem.mjs /tmp/qrverify
node tools/verify-mobile.mjs  /tmp/qrverify
node tools/verify-topicos.mjs /tmp/qrverify
```

Os verificadores de navegador precisam do Playwright **fora** do projeto:

```bash
mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core
```

`verify-mobile` e `verify-topicos` rodam contra um servidor que já esteja no ar.
Os outros sobem o próprio servidor.

**Sempre rode `smoke.mjs` antes de commitar.** Ele é rápido e pega o grosso.

### Depurar um teste de navegador

```bash
DIAG=1 node tools/verify-jogo.mjs /tmp/qrverify   # imprime a geometria da mesa
```

---

## 5. Mapa do repositório

```
data/
  cards.csv          AS CARTAS — a fonte, editável em planilha
  cards.meta.json    o que não é carta: versão, aviso, campos obrigatórios
  cards.seed.json    GERADO do CSV; é o que o app lê
  curadoria.json     revisão: status, revisor, data, motivo
  topics.json        16 temas: slug, label, símbolo, cor, sinônimos
  creditos.json      fonte única da página de créditos
  cards.demo.json    fixtures (com link / sem fonte) — só para teste
lib/                 módulos puros, rodam no Node e no navegador
  qr.mjs             encoder + SVG do QR (e o QR em forma de carta)
  csv.mjs            CSV RFC 4180: parser e escritor
  deck.mjs           filtro, shuffle com seed, espelhamento duplex
  jogo.mjs           sessão do jogo (puro, sem DOM)
  topics.mjs         overlay de tópicos do usuário
  store.mjs          persistência local do overlay
tools/               scripts e verificadores (não vão para o runtime)
  cards-csv.mjs      exportar / importar / conferir a planilha
  comum.mjs          clique em ponto alcançável (ver §7)
  verify-*.mjs       verificadores de navegador
web/
  server.mjs         node:http, estático + API (única escrita: POST /api/curadoria)
  public/            páginas, CSS e JS do navegador
test/smoke.mjs       a suíte principal
docs/PLANO.md        plano original
```

---

## 6. Convenções

- **Zero dependências.** Runtime só com a biblioteca padrão do Node. Não adicione
  pacote sem uma razão que se sustente.
- **ESM** (`.mjs` ou `type: module`). Nada de `require` no código do app (só nos
  verificadores, que usam Playwright de fora).
- **Português** em nomes, comentários e textos de interface. O código é lido por
  quem fala português; mantenha assim.
- **Nada de `innerHTML` com dado.** Monte nós com `textContent`. O único
  `innerHTML` aceito é com SVG gerado aqui (o QR).
- **Comentário explica o porquê, não o quê.** Vários comentários deste projeto
  registram um erro que já aconteceu — preserve-os.
- **Funções puras em `lib/`**, DOM só em `web/public/`.

---

## 7. Armadilhas (erros reais que já custaram tempo)

### As cartas se sobrepõem de propósito
O `click()` do Playwright exige o centro livre e **falha** quando uma carta cobre
a outra. Use `tools/comum.mjs`:

```js
import { clicarNaCarta, cartasInalcancaveis } from './comum.mjs';
await clicarNaCarta(pagina, id);
```

A regra verificada é **alcançabilidade**, não centro livre.

### Medir durante a transição
Escolher uma carta reposiciona as outras com transição de **320 ms**. Medir antes
disso acusa sobreposição que não existe no repouso. Espere ~450 ms. Foi a causa de
uma suíte que variava entre 72 e 76 verificações sem falhar.

### O sorteio não pode vir depois do candidato neutro
Em `posicoesEspalhadas`, os candidatos **sorteados vêm primeiro** e o centro da
célula é a última reserva. Com o neutro na frente ele vencia sempre (conflito
zero) e a mesa voltava a ser uma grade dura, sem giro.

### Testes que escrevem
`smoke.mjs` e `verify-triagem.mjs` **gravam** curadoria. Use arquivo descartável
(`BARALHO_CURADORIA`) e limpe **antes e depois** — um resto de execução anterior
envenena a próxima (já aconteceu).

### Teste acoplado ao estado da pesquisa
Um teste apontava para "os temas sem fonte". Assim que a curadoria deu fonte a
esses temas, o teste quebrou. Para o caminho "sem fonte", use o fixture
`cards.semfonte.json`, não o conjunto real.

### O container não é a carta
O `.mao` é um retângulo que cobre a mesa inteira. Tratar "clique dentro do `.mao`"
como clique em carta engolia o clique no feltro: devolver a carta só funcionava
numa margem estreita. Regra: ignore só `#carta`, `.carta-mesa`, `#monte`,
`#engrenagem`, `#painel`.

### O `--r: 0.0deg` denuncia
Se ao inspecionar você vir todas as cartas com rotação zero, o sorteio não está
sendo aplicado — é sintoma de candidato neutro vencendo (ver acima).

---

## 8. Tarefas comuns

**Acrescentar ou corrigir carta**

```bash
# 1. edite data/cards.csv (planilha, uma linha por carta)
node tools/cards-csv.mjs importar    # regenera o JSON
node tools/cards-csv.mjs conferir    # falha se os dois divergirem
node test/smoke.mjs
```

O importador recusa: coluna desconhecida, `id` ou número repetido, status fora do
vocabulário, aprovada sem fonte, rejeitada sem motivo.

**Aprovar cartas** — use `/triagem.html`. O servidor grava em `data/curadoria.json`
com revisor e data. Não edite esse arquivo à mão para "aprovar em massa": a
trilha de auditoria é o produto.

**Mexer no QR** — `lib/qr.mjs`. Depois rode `verify-qr.mjs`, que compara com uma
referência externa. O QR em forma de carta tem regras próprias (zona de silêncio
limpa, localizadores com geometria exata) — o comentário no arquivo explica por quê.

**Mexer no espalhamento** — `posicoesEspalhadas` em `web/public/jogo.js`. Depois
rode `verify-jogo.mjs` várias vezes (é aleatório) e confira `cartasInalcancaveis`.

---

## 9. Limites éticos e legais — leia antes de acrescentar conteúdo

- **Nunca invente citação, fonte ou atribuição.** Se não achou fonte, a carta fica
  marcada como sem fonte e **não pode ser aprovada**. O acervo já teve uma
  atribuição errada (carta 26, que era de outra pessoa) — ela está rejeitada com o
  motivo gravado. Prefira rejeitar a inventar.
- **Fontes de terceiros e acusações.** Se a fonte é uma acusação de adversário e
  não uma fala do próprio, escreva isso na observação. Um link que não sustenta a
  frase é pior que nenhum link: empresta credibilidade.
- **O dorso das cartas é derivado de uma foto de baralho Copag.** Serve para uso
  local e de pesquisa; para redistribuir em escala, troque a textura
  (`web/public/padrao-dorso.webp`). A ressalva está em `data/creditos.json`.
- **O baralho original não traz fonte em nenhuma carta** e a licença de reuso não
  foi confirmada. Não afirme o contrário nos créditos.
- **Conteúdo político e pessoas reais.** Não acrescente adjetivo ("fascista",
  "racista") ao texto da carta. O produto mostra a frase e a fonte; o juízo é de
  quem joga.

---

## 10. Antes de commitar

```bash
node test/smoke.mjs
node tools/verify-jogo.mjs /tmp/qrverify     # rode 2–3 vezes: tem aleatoriedade
git status --short                            # sem resíduo de teste em data/
```

Confira que `data/` não tem `curadoria.teste.json`, `curadoria.verify.json` nem
`.tmp` — eles estão no `.gitignore`, mas se aparecerem versionados é sinal de que
algo vazou.
