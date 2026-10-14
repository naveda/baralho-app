/**
 * A mesa: cartas distribuídas sobre o feltro, o usuário escolhe uma e vira.
 *
 * Sem placar, sem métrica, sem texto explicando — o baralho é jogado ao vivo,
 * entre pessoas. A interação é a do objeto:
 *
 *   clicar numa carta da mesa → ela vem para o centro e mostra a citação
 *   clicar na carta do centro → vira: autor e fonte (link + QR)
 *   clicar no monte           → distribui novas cartas
 *   S                         → embaralha
 *   ← / →                     → carta anterior / próxima da mesa
 *
 * O nome do autor não existe no DOM antes de a carta ser virada.
 */

import { qrSvgCarta } from '/lib/qr.mjs';
import { aplicarOverlay, listarTopicos, overlayVazio } from '/lib/topics.mjs';
import { normalize, textoData } from '/lib/deck.mjs';
import { lerOverlay } from '/lib/store.mjs';
import { montarBaralho, novaSessao, restantes, avancar, retroceder, reembaralhar } from '/lib/jogo.mjs';

const $ = (id) => document.getElementById(id);
const criar = (tag, classe, texto) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto != null) el.textContent = texto;
  return el;
};

/** Símbolo do tema → naipe do baralho. */
const NAIPE_POR_SIMBOLO = { '♥': 'copas', '♦': 'ouros', '♠': 'espadas', '♣': 'paus' };
const CAMADAS_MAX = 9;

let CARTAS = [];
let TEMAS = [];
let TEMA_POR_SLUG = new Map();
let OVERLAY = overlayVazio();
const temasSelecionados = new Set();

let BARALHO = [];
let SESSAO = null;
let MESA = [];          // cartas distribuídas agora
let escolhida = null;   // carta no centro
let virada = false;
const seed = new URLSearchParams(location.search).get('seed') || '';

const cartasEfetivas = () => aplicarOverlay(CARTAS, OVERLAY, TEMA_POR_SLUG);
// No celular a tela é estreita e a carta escolhida ocupa o meio: sobram as
// faixas de cima e de baixo. Seis cartas é o que cabe mantendo-as grandes.
const porMesa = () => (window.innerWidth < 700 ? 6 : 8);

/** Mede a carta escolhida sem exibi-la, para saber que espaço ela ocupa. */
function medirDestaque() {
  const sonda = document.createElement('div');
  sonda.className = 'sonda-carta';
  document.body.append(sonda);
  const caixa = sonda.getBoundingClientRect();
  sonda.remove();
  return { largura: caixa.width, altura: caixa.height };
}

/** Retrato: a mesa é mais alta que larga (celular em pé). Muda só o tamanho. */
const ehRetrato = () => window.innerHeight > window.innerWidth * 1.15;

/**
 * A carta é girada, então a caixa dela fica maior que a carta. `ENVELOPE` é
 * quanto a caixa cresce com o giro máximo.
 */
const ENVELOPE_X = 1.24;
const ENVELOPE_Y = 1.14;

/**
 * Amplitude do sorteio de posição, como fração do passo da grade.
 *
 * Aqui está o equilíbrio do espalhamento. O passo da grade é o envelope da
 * carta (o quanto ela ocupa já contando o giro), então duas cartas vizinhas
 * ficam a uma distância entre `1 - JITTER/2` e `1 + JITTER/2` passos.
 *
 * Com JITTER = 0.24 a distância mínima é 0.88 do passo — as caixas se cruzam,
 * ou seja **há sobreposição**, mas nunca a ponto de uma cobrir o centro da
 * outra. Sobrepor é o que dá o ar de baralho jogado; passar disso começa a
 * esconder carta, e carta escondida não dá para escolher.
 */
const JITTER = 0.24;

/** Proporção de uma carta de baralho (63 × 88 mm). */
const PROPORCAO = 63 / 88;

/** O ponto cai dentro da carta girada? (coordenadas locais) */
function dentroDaCarta(px, py, carta) {
  const dx = px - carta.x;
  const dy = py - carta.y;
  const a = (-carta.r * Math.PI) / 180;
  const lx = dx * Math.cos(a) - dy * Math.sin(a);
  const ly = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(lx) <= carta.largura / 2 && Math.abs(ly) <= carta.altura / 2;
}

/**
 * Retângulo reservado para a carta escolhida. Sem essa reserva, uma carta
 * espalhada cai atrás da carta grande e fica impossível de clicar.
 */
function retanguloReservado(zona, destaque) {
  const folga = 16;
  if (!destaque.largura) return null;
  return {
    x0: (zona.width - destaque.largura) / 2 - folga,
    x1: (zona.width + destaque.largura) / 2 + folga,
    y0: (zona.height - destaque.altura) / 2 - folga,
    y1: (zona.height + destaque.altura) / 2 + folga,
  };
}

/** Células de uma grade `colunas × linhas` fora do retângulo reservado. */
function celulasLivres(zona, destaque, colunas, linhas) {
  const reserva = retanguloReservado(zona, destaque);
  const passoX = zona.width / colunas;
  const passoY = zona.height / linhas;
  const celulas = [];
  for (let l = 0; l < linhas; l++) {
    for (let c = 0; c < colunas; c++) {
      const cx = (c + 0.5) * passoX;
      const cy = (l + 0.5) * passoY;
      if (reserva && cx > reserva.x0 && cx < reserva.x1 && cy > reserva.y0 && cy < reserva.y1) continue;
      celulas.push({ cx, cy, passoX, passoY });
    }
  }
  return celulas;
}

/**
 * Distribui as cartas numa grade frouxa, com jitter e giro sorteados.
 *
 * Procura a grade mais grossa (logo, cartas maiores) que ainda deixe células
 * livres suficientes, mede a maior carta que cabe na célula e devolve as
 * posições em porcentagem da zona.
 */
function posicoesEspalhadas(quantas, reservarCentro) {
  // O formato precisa ser decidido ANTES de medir: ele muda o tamanho da zona
  // das cartas e o da carta escolhida.
  const retrato = ehRetrato();
  const mesa = document.querySelector('.mesa');
  if (mesa) mesa.dataset.formato = retrato ? 'retrato' : 'paisagem';

  const zona = $('mao').getBoundingClientRect();
  if (zona.width < 60 || zona.height < 60) return { posicoes: [], altura: 0 };

  // Só reserva o centro quando a carta grande está na mesa. Sem ela, as cartas
  // ocupam a tela toda — é o que dá o ar de baralho espalhado.
  const destaque = reservarCentro ? medirDestaque() : { largura: 0, altura: 0 };

  let melhor = null;
  for (let colunas = 2; colunas <= 8; colunas++) {
    for (let linhas = 2; linhas <= 8; linhas++) {
      const celulas = celulasLivres(zona, destaque, colunas, linhas);
      if (celulas.length < quantas) continue;
      const passoX = zona.width / colunas;
      const passoY = zona.height / linhas;
      // a grade garante separação; a sobreposição vem do sorteio, que é validado
      const largura = Math.min(
        passoX / ENVELOPE_X,
        (passoY / ENVELOPE_Y) * PROPORCAO,
        168
      );
      const altura = largura / PROPORCAO;
      if (!melhor || altura > melhor.altura) melhor = { celulas, altura, largura };
    }
  }
  if (!melhor) return { posicoes: [], altura: 0 };

  const { celulas, altura, largura } = melhor;
  for (let i = celulas.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [celulas[i], celulas[j]] = [celulas[j], celulas[i]];
  }

  const reserva = retanguloReservado(zona, destaque);
  const envelopeX = largura * ENVELOPE_X;
  const envelopeY = altura * ENVELOPE_Y;
  const limiteX = envelopeX / 2;
  const limiteY = envelopeY / 2;

  const dentroDaReserva = (x, y) =>
    reserva && x > reserva.x0 && x < reserva.x1 && y > reserva.y0 && y < reserva.y1;

  /** Quantos centros este lugar cobriria — ou seria coberto por eles. */
  const conflitos = (candidata, jaPostas) =>
    jaPostas.reduce(
      (soma, outra) =>
        soma +
        (dentroDaCarta(candidata.x, candidata.y, outra) ? 1 : 0) +
        (dentroDaCarta(outra.x, outra.y, candidata) ? 1 : 0),
      0
    );

  const posicoes = [];
  for (const celula of celulas.slice(0, quantas)) {
    let melhorCandidata = null;
    let melhorConflito = Infinity;

    // Sorteia e confere: a carta pode encostar na vizinha, mas não pode cobrir o
    // centro dela — é ali que o dedo acerta.
    //
    // O sorteio vem PRIMEIRO e o centro da célula fica por último, só como
    // reserva. Com o centro na frente ele vencia sempre (conflito zero), e a
    // mesa voltava a ser uma grade dura, sem giro nenhum.
    const tentativas = [];
    for (let t = 0; t < 40; t++) {
      tentativas.push({
        x: celula.cx + (Math.random() - 0.5) * celula.passoX * JITTER,
        y: celula.cy + (Math.random() - 0.5) * celula.passoY * JITTER,
        r: (Math.random() - 0.5) * 30,
      });
    }
    tentativas.push({ x: celula.cx, y: celula.cy, r: 0 });

    for (const tentativa of tentativas) {
      const candidata = {
        x: Math.min(Math.max(tentativa.x, limiteX), zona.width - limiteX),
        y: Math.min(Math.max(tentativa.y, limiteY), zona.height - limiteY),
        r: tentativa.r,
        largura,
        altura,
      };
      if (dentroDaReserva(candidata.x, candidata.y)) continue;
      const conflito = conflitos(candidata, posicoes);
      if (conflito === 0) { melhorCandidata = candidata; melhorConflito = 0; break; }
      if (conflito < melhorConflito) { melhorCandidata = candidata; melhorConflito = conflito; }
    }

    posicoes.push(melhorCandidata);
  }

  const emPorcentagem = posicoes.map((c) => ({
    x: (c.x / zona.width) * 100,
    y: (c.y / zona.height) * 100,
    r: c.r,
  }));

  return { posicoes: emPorcentagem, altura };
}

/* ------------------------------------------------------------------ *
 * Carga
 * ------------------------------------------------------------------ */

async function carregar() {
  const [resCartas, resTemas] = await Promise.all([
    fetch('/api/cards?draft=1', { cache: 'no-store' }),
    fetch('/api/topics', { cache: 'no-store' }),
  ]);
  if (!resCartas.ok) throw new Error('GET /api/cards → ' + resCartas.status);
  CARTAS = (await resCartas.json()).cards || [];
  if (resTemas.ok) {
    TEMAS = (await resTemas.json()).temas || [];
    TEMA_POR_SLUG = new Map(TEMAS.map((t) => [normalize(t.slug), t]));
  }
  OVERLAY = lerOverlay();

  const temas = new URLSearchParams(location.search).get('temas');
  if (temas) for (const t of temas.split(',').map((s) => s.trim()).filter(Boolean)) temasSelecionados.add(t);

  montarAbas();
  armar();
}

/* ------------------------------------------------------------------ *
 * Baralho e mesa
 * ------------------------------------------------------------------ */

function armar() {
  BARALHO = montarBaralho(cartasEfetivas(), {
    temas: [...temasSelecionados],
    incluirRascunho: true,
    ordem: 'embaralhado',
    seed,
  });
  SESSAO = BARALHO.length ? novaSessao(BARALHO, { seed, temas: [...temasSelecionados] }) : null;
  escolhida = null;
  virada = false;
  $('carta').hidden = true;
  $('carta').classList.remove('virada', 'entrando');
  limparVerso();
  distribuir();
}

/** Põe as próximas cartas na mesa (ou reembaralha quando o monte acaba). */
function distribuir() {
  const mao = $('mao');
  mao.innerHTML = '';
  MESA = [];

  if (!SESSAO || !SESSAO.total) {
    const aviso = criar('p', 'recado', CARTAS.length ? 'nenhuma carta neste tema' : 'sem cartas');
    mao.append(aviso);
    desenharMonte();
    return;
  }

  const quantas = Math.min(porMesa(), restantes(SESSAO) + 1);
  for (let i = 0; i < quantas; i++) {
    const carta = BARALHO[SESSAO.indice];
    if (!carta) break;
    MESA.push(carta);
    mao.append(cartaNaMesa(carta));
    SESSAO = avancar(SESSAO);
  }
  espalharCartas(false);

  // Chegou ao fim do monte: a próxima distribuição recomeça embaralhada.
  if (SESSAO.fim) SESSAO = reembaralhar(SESSAO, BARALHO);

  desenharMonte();
}

/**
 * Reposiciona as cartas ainda não escolhidas. Com `reservarCentro`, a grade
 * desvia do lugar da carta grande: é assim que as cartas "abrem espaço" e
 * nenhuma fica escondida atrás dela.
 */
function espalharCartas(reservarCentro) {
  const mao = $('mao');
  // Todas entram no cálculo, inclusive as já escolhidas: uma carta parada na
  // posição antiga colidiria com a grade nova.
  const botoes = [...mao.querySelectorAll('.carta-mesa')];
  if (!botoes.length) return;
  const { posicoes, altura } = posicoesEspalhadas(botoes.length, reservarCentro);
  if (altura) mao.style.setProperty('--altura-carta', Math.round(altura) + 'px');
  botoes.forEach((b, i) => {
    const p = posicoes[i];
    if (!p) return;
    b.style.setProperty('--x', p.x.toFixed(2) + '%');
    b.style.setProperty('--y', p.y.toFixed(2) + '%');
    b.style.setProperty('--r', p.r.toFixed(1) + 'deg');
  });
}

function cartaNaMesa(carta) {
  const b = criar('button', 'carta-mesa');
  b.type = 'button';
  b.dataset.id = carta.id;
  b.title = 'Escolher esta carta';
  b.setAttribute('aria-label', 'Carta virada para baixo na mesa');
  b.addEventListener('click', () => escolher(carta, b));
  return b;
}

function desenharMonte() {
  const pilha = $('monte-pilha');
  pilha.innerHTML = '';
  const restam = SESSAO ? restantes(SESSAO) + 1 : 0;
  const camadas = Math.max(1, Math.min(CAMADAS_MAX, restam));
  for (let i = 0; i < camadas; i++) {
    const camada = criar('span', 'monte__camada');
    camada.style.transform = `translate(${-i * 1.2}px, ${-i * 1.8}px)`;
    camada.style.zIndex = String(CAMADAS_MAX - i);
    pilha.append(camada);
  }
  $('monte').classList.toggle('monte--vazio', restam <= 0 || MESA.length > 0);
}

/* ------------------------------------------------------------------ *
 * Escolher e virar
 * ------------------------------------------------------------------ */

function escolher(carta, elemento) {
  if (!carta) return;

  const elCarta = $('carta');
  const jaVisivel = !elCarta.hidden;
  elCarta.hidden = false;
  elCarta.classList.remove('virada');
  limparVerso();

  // Origem da animação: de onde a carta saiu na mesa.
  if (elemento && !jaVisivel) {
    const de = elemento.getBoundingClientRect();
    const para = elCarta.getBoundingClientRect();
    elCarta.style.setProperty('--de-x', (de.left + de.width / 2 - (para.left + para.width / 2)).toFixed(1) + 'px');
    elCarta.style.setProperty('--de-y', (de.top + de.height / 2 - (para.top + para.height / 2)).toFixed(1) + 'px');
    elCarta.style.setProperty('--de-escala', (de.width / para.width).toFixed(3));
    elCarta.classList.remove('entrando');
    void elCarta.offsetWidth;
    elCarta.classList.add('entrando');
  }

  if (elemento) elemento.classList.add('vista');

  escolhida = carta;
  virada = false;
  pintarFrente(carta);
  // as outras abrem espaço para a carta grande
  espalharCartas(true);
}

function pintarFrente(card) {
  const tema = card._topico || TEMA_POR_SLUG.get(normalize(card.topic));
  const simbolo = tema?.simbolo || '♠';
  const cor = tema?.cor === 'vermelho' ? ' carta__indice--vermelho' : '';
  const numero = String(card.numeroNaCarta ?? card.id ?? '');

  for (const alvo of [['indice-tl', ''], ['indice-br', ' carta__indice--br']]) {
    const caixa = $(alvo[0]);
    caixa.className = 'carta__indice' + alvo[1] + cor;
    caixa.innerHTML = '';
    caixa.append(criar('b', null, numero), criar('i', null, simbolo));
  }

  $('citacao').textContent = '“' + card.quote + '”';
  // Só o identificador do tema basta; o nome só entra se o usuário o tiver criado.
  $('tema').textContent = '#' + card.topic + (tema && tema.proprio ? ' · ' + tema.label : '');
  $('carta').setAttribute('aria-label', 'Carta ' + numero + '. ' + card.quote + ' Toque para virar.');
  ajustarCitacao();
}

/**
 * Devolve a carta à mesa: o verso é limpo, a carta volta virada para baixo e a
 * mesa recupera o espalhamento cheio. É o que acontece ao clicar fora dela.
 */
function recolher() {
  const carta = escolhida;
  if (!carta) return;

  const elCarta = $('carta');
  const naMesa = document.querySelector('.carta-mesa[data-id="' + carta.id + '"]');
  escolhida = null;
  virada = false;

  if (naMesa && !elCarta.hidden) {
    // animação inversa: a carta volta para o lugar de onde saiu
    const de = elCarta.getBoundingClientRect();
    const para = naMesa.getBoundingClientRect();
    elCarta.style.setProperty('--de-x', (para.left + para.width / 2 - (de.left + de.width / 2)).toFixed(1) + 'px');
    elCarta.style.setProperty('--de-y', (para.top + para.height / 2 - (de.top + de.height / 2)).toFixed(1) + 'px');
    elCarta.style.setProperty('--de-escala', (para.width / de.width).toFixed(3));
    elCarta.classList.remove('entrando');
    elCarta.classList.add('saindo');
    window.setTimeout(() => {
      elCarta.hidden = true;
      elCarta.classList.remove('saindo');
    }, 300);
  } else {
    elCarta.hidden = true;
  }

  elCarta.classList.remove('virada');
  limparVerso();
  for (const b of document.querySelectorAll('.carta-mesa')) b.classList.remove('vista');
  espalharCartas(false);
}

function virar() {
  if (!escolhida || virada) return;
  montarVerso(escolhida);
  $('carta').classList.add('virada');
  virada = true;
  $('carta').setAttribute('aria-label', 'Carta virada. ' + (escolhida.autor || 'autoria não confirmada') + '.');
}

/**
 * Esvazia o verso. O nome do autor da carta anterior não pode continuar no DOM
 * enquanto a próxima está fechada.
 */
function limparVerso() {
  $('autor').textContent = '';
  $('data').textContent = '';
  $('fonte').innerHTML = '';
  const carimbo = document.querySelector('.carta__carimbo');
  if (carimbo) carimbo.remove();
  // O rótulo também não pode guardar o nome: com a carta fechada, o autor não
  // pode existir em lugar nenhum do DOM.
  $('carta').setAttribute('aria-label', 'Carta escolhida. Toque para virar.');
}

function montarVerso(card) {
  limparVerso();
  $('autor').textContent = card.autor || 'autoria não confirmada';
  $('data').textContent = [textoData(card), card.veiculo].filter(Boolean).join(' · ');

  const tema = card._topico || TEMA_POR_SLUG.get(normalize(card.topic));
  const naipe = NAIPE_POR_SIMBOLO[tema?.simbolo] || 'espadas';
  const fonte = $('fonte');

  // A fonte é o que dá sentido à carta: se não houver, dizemos que não há.
  if (card.link) {
    // QR e endereço são UM alvo clicável só: é o que leva à fonte.
    const a = document.createElement('a');
    a.className = 'carta__fonte-link';
    a.href = card.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = 'Abrir a fonte: ' + card.link;
    // O clique no link abre a fonte e não pode virar a carta.
    a.addEventListener('click', (e) => e.stopPropagation());

    const caixaQr = criar('div', 'carta__qr');
    caixaQr.innerHTML = qrSvgCarta(card.link, { naipe, titulo: 'Fonte: ' + card.link });
    a.append(caixaQr);
    a.append(criar('span', 'carta__url', 'ver a fonte'));
    a.append(criar('span', 'carta__endereco',
      card.link.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')));

    fonte.append(a);
  } else {
    fonte.append(criar('div', 'carta__qr carta__qr--vazio', 'sem fonte'));
    fonte.append(criar('p', 'carta__sem-fonte', 'fonte não anexada'));
  }

  if (card.status !== 'approved') {
    document.querySelector('.carta__cartucho').append(criar('span', 'carta__carimbo', 'não verificado'));
  }
}

/** Citações longas cabem sem estourar a carta. */
function ajustarCitacao() {
  const caixa = document.querySelector('.carta__citacao');
  const texto = $('citacao');
  if (!caixa || !texto) return;
  let tamanho = 1;
  caixa.style.fontSize = '';
  let voltas = 0;
  while (texto.offsetHeight > caixa.clientHeight && tamanho > 0.45 && voltas++ < 40) {
    tamanho -= 0.04;
    caixa.style.fontSize = tamanho.toFixed(2) + 'em';
  }
}

/** Anda pela mesa (← →) escolhendo a carta anterior/seguinte. */
function andarNaMesa(passo) {
  if (!MESA.length) return;
  const atual = escolhida ? MESA.findIndex((c) => c.id === escolhida.id) : -1;
  const proximo = Math.min(MESA.length - 1, Math.max(0, atual + passo));
  const carta = MESA[proximo];
  const botao = document.querySelector('.carta-mesa[data-id="' + carta.id + '"]');
  escolher(carta, botao);
}

function embaralhar() {
  if (!SESSAO) return;
  SESSAO = reembaralhar(SESSAO, BARALHO);
  escolhida = null;
  virada = false;
  $('carta').hidden = true;
  limparVerso();
  distribuir();
}

/* ------------------------------------------------------------------ *
 * Abas de tema
 * ------------------------------------------------------------------ */

function montarAbas() {
  const caixa = $('temas');
  caixa.innerHTML = '';

  const todos = criar('button', 'aba-tema');
  todos.type = 'button';
  todos.setAttribute('aria-pressed', temasSelecionados.size === 0 ? 'true' : 'false');
  todos.append(document.createTextNode('todos'));
  todos.append(criar('b', 'aba-tema__conta', String(CARTAS.length)));
  todos.title = `${CARTAS.length} cartas no baralho`;
  todos.addEventListener('click', () => {
    temasSelecionados.clear();
    montarAbas();
    armar();
  });
  caixa.append(todos);

  for (const tema of listarTopicos(CARTAS, OVERLAY, TEMAS)) {
    if (!tema.total) continue;
    const b = criar('button', 'aba-tema');
    b.type = 'button';
    if (tema.simbolo) b.append(document.createTextNode(tema.simbolo + ' '));
    b.append(document.createTextNode(tema.label));
    // Quantas cartas o tema tem: é o que diz se vale escolher esse monte.
    const conta = criar('b', 'aba-tema__conta', String(tema.total));
    conta.title = tema.total === 1 ? '1 carta neste tema' : `${tema.total} cartas neste tema`;
    b.append(conta);
    b.title = `${tema.label}: ${conta.title}`;
    b.setAttribute('aria-pressed', temasSelecionados.has(tema.slug) ? 'true' : 'false');
    b.addEventListener('click', () => {
      if (temasSelecionados.has(tema.slug)) temasSelecionados.delete(tema.slug);
      else temasSelecionados.add(tema.slug);
      montarAbas();
      armar();
    });
    caixa.append(b);
  }
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

$('monte').addEventListener('click', distribuir);
$('carta').addEventListener('click', virar);

/* A engrenagem guarda o que não é baralho: temas e navegação. */
const engrenagem = $('engrenagem');
const painel = $('painel');

function abrirPainel(abrir) {
  painel.hidden = !abrir;
  engrenagem.setAttribute('aria-expanded', String(abrir));
}

engrenagem.addEventListener('click', (e) => {
  e.stopPropagation();
  abrirPainel(painel.hidden);
});

// Cliques dentro do painel morrem aqui. E precisam morrer: escolher um tema
// reconstrói a lista, então quando o evento chegasse ao document o alvo já
// estaria fora do DOM e o painel se fecharia sozinho.
painel.addEventListener('click', (e) => e.stopPropagation());

document.addEventListener('click', (e) => {
  // O painel aberto consome o primeiro clique de fora: só se fecha.
  if (!painel.hidden) {
    if (!engrenagem.contains(e.target)) abrirPainel(false);
    return;
  }
  // Quem tem dono é a CARTA, não o container delas: `.mao` é um retângulo que
  // cobre quase toda a mesa, e ignorá-lo engolia o clique no feltro — só
  // funcionava na estreita margem de fora.
  if (e.target.closest('#carta, .carta-mesa, #monte, #engrenagem, #painel')) return;
  recolher();
});

document.addEventListener('keydown', (e) => {
  const alvo = e.target;
  if (alvo && /^(INPUT|SELECT|TEXTAREA)$/.test(alvo.tagName)) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (!painel.hidden) abrirPainel(false);
    else recolher();
    return;
  }
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (escolhida && !virada) virar();
    else if (!escolhida && MESA.length) andarNaMesa(1);
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    andarNaMesa(1);
  } else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    andarNaMesa(-1);
  } else if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    embaralhar();
  }
});

carregar().catch((err) => {
  $('mao').append(criar('p', 'recado', 'sem cartas — ' + err.message));
});
