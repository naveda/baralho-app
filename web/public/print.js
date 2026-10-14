/**
 * Estúdio de impressão do baralho.
 *
 * Monta folhas em tamanho real (mm) com frente e verso alinhados, gera o QR de
 * cada fonte localmente (lib/qr.mjs) e imprime pelo próprio navegador — sem
 * servidor de PDF e sem dependências.
 *
 * Regra que o código respeita: cartas com status diferente de `approved` só
 * entram em modo rascunho e, por padrão, saem com a tarja NÃO VERIFICADO.
 */

import { qrSvg } from '/lib/qr.mjs';
import { arrange, filterCards, chunk, padToMultiple, mirrorForDuplex, normalize, textoData } from '/lib/deck.mjs';
import { aplicarOverlay, listarTopicos, overlayVazio } from '/lib/topics.mjs';
import { lerOverlay } from '/lib/store.mjs';

/* ------------------------------------------------------------------ *
 * Geometria
 * ------------------------------------------------------------------ */

const PAPEL = {
  a4l: { w: 297, h: 210, nome: 'A4 paisagem', grade: { 8: [4, 2], 6: [3, 2], 9: [3, 3], 4: [2, 2] } },
  a4p: { w: 210, h: 297, nome: 'A4 retrato', grade: { 8: [2, 4], 6: [2, 3], 9: [3, 3], 4: [2, 2] } },
  letl: { w: 279.4, h: 215.9, nome: 'Letter paisagem', grade: { 8: [4, 2], 6: [3, 2], 9: [3, 3], 4: [2, 2] } },
  letp: { w: 215.9, h: 279.4, nome: 'Letter retrato', grade: { 8: [2, 4], 6: [2, 3], 9: [3, 3], 4: [2, 2] } },
};

const TAMANHOS = { poker: [63, 88], bridge: [57, 89], mini: [44, 67] };

const PADROES = {
  busca: '', rascunho: true, quantidade: 'todas', ordem: 'numero', seed: '', copias: 1,
  papel: 'a4l', porFolha: '8', tamanho: 'auto', margem: 8, espaco: 2, marcas: 'borda',
  rodape: true, modo: 'duplex', borda: 'longa', qr: true, link: true, tarja: true,
  simbolos: 'uniforme', escala: 45,
};

const $ = (id) => document.getElementById(id);
const criar = (tag, classe, texto) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto != null) el.textContent = texto;
  return el;
};

/* ------------------------------------------------------------------ *
 * Estado
 * ------------------------------------------------------------------ */

let CARTAS = [];
let TEMAS = [];
let TEMA_POR_SLUG = new Map();
let OVERLAY = overlayVazio();
// Guarda o slug EFETIVO (já com renomeações), que é o que aparece na carta.
const temasSelecionados = new Set();

/** Cartas com o tópico já resolvido pela camada de tópicos do usuário. */
const cartasEfetivas = () => aplicarOverlay(CARTAS, OVERLAY, TEMA_POR_SLUG);
const listaDeTopicos = () => listarTopicos(CARTAS, OVERLAY, TEMAS);

/* ------------------------------------------------------------------ *
 * Carga de dados
 * ------------------------------------------------------------------ */

async function carregar() {
  const [resCartas, resTemas] = await Promise.all([
    fetch('/api/cards?draft=1', { cache: 'no-store' }),
    fetch('/api/topics', { cache: 'no-store' }),
  ]);
  if (!resCartas.ok) throw new Error('GET /api/cards → ' + resCartas.status);
  const dados = await resCartas.json();
  CARTAS = dados.cards || [];
  if (resTemas.ok) {
    const t = await resTemas.json();
    TEMAS = t.temas || [];
    TEMA_POR_SLUG = new Map(TEMAS.map((tema) => [normalize(tema.slug), tema]));
  }
  OVERLAY = lerOverlay();
  montarChips();
}

function montarChips() {
  const caixa = $('temas');
  caixa.innerHTML = '';
  const itens = listaDeTopicos();
  if (!itens.length) {
    caixa.append(criar('span', 'dica', 'temas indisponíveis'));
    return;
  }
  for (const tema of itens) {
    const b = criar('button', 'chip' + (tema.proprio ? ' chip--proprio' : ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', temasSelecionados.has(tema.slug) ? 'true' : 'false');
    b.title = tema.proprio ? 'Tópico próprio: ' + tema.label : 'Tema da taxonomia: ' + tema.label;
    b.append((tema.simbolo ? tema.simbolo + ' ' : '') + tema.label + ' (' + tema.total + ')');
    b.addEventListener('click', () => {
      if (temasSelecionados.has(tema.slug)) temasSelecionados.delete(tema.slug);
      else temasSelecionados.add(tema.slug);
      b.setAttribute('aria-pressed', temasSelecionados.has(tema.slug) ? 'true' : 'false');
      render();
    });
    caixa.append(b);
  }
}

/* ------------------------------------------------------------------ *
 * Configuração
 * ------------------------------------------------------------------ */

function lerConfig() {
  const papel = $('papel').value;
  const P = PAPEL[papel] || PAPEL.a4l;
  const porFolha = Number($('porFolha').value);
  const [cols, rows] = P.grade[porFolha] || P.grade[8];
  return {
    papel, pageW: P.w, pageH: P.h, cols, rows, porFolha,
    temas: [...temasSelecionados],
    busca: $('busca').value,
    rascunho: $('rascunho').checked,
    quantidade: $('quantidade').value,
    ordem: $('ordem').value,
    seed: $('seed').value,
    copias: Math.max(1, Math.min(6, Number($('copias').value) || 1)),
    tamanho: $('tamanho').value,
    margem: Number($('margem').value),
    espaco: Number($('espaco').value),
    marcas: $('marcas').value,
    rodape: $('rodape').checked,
    modo: $('modo').value,
    borda: $('borda').value,
    qr: $('qr').checked,
    link: $('link').checked,
    tarja: $('tarja').checked,
    simbolos: $('simbolos').value,
    escala: Number($('escala').value) / 100,
  };
}

function calcularTamanho(cfg) {
  const alturaRodape = cfg.rodape ? 6 : 0;
  const dispW = cfg.pageW - 2 * cfg.margem - cfg.espaco * (cfg.cols - 1);
  const dispH = cfg.pageH - 2 * cfg.margem - cfg.espaco * (cfg.rows - 1) - alturaRodape;
  const maxW = dispW / cfg.cols;
  const maxH = dispH / cfg.rows;

  if (cfg.tamanho === 'auto') {
    const razao = 63 / 88; // proporção de carta de pôquer
    let w = maxW;
    let h = maxH;
    if (w / h > razao) w = h * razao;
    else h = w / razao;
    return { w: arredondar(w), h: arredondar(h), reduzida: false };
  }

  let [w, h] = TAMANHOS[cfg.tamanho];
  let reduzida = false;
  if (w > maxW || h > maxH) {
    const f = Math.min(maxW / w, maxH / h);
    w *= f;
    h *= f;
    reduzida = true;
  }
  return { w: arredondar(w), h: arredondar(h), reduzida };
}

const arredondar = (n) => Math.round(n * 100) / 100;

function aplicarGeometria(cfg) {
  const { w, h, reduzida } = calcularTamanho(cfg);
  const raiz = document.documentElement.style;
  raiz.setProperty('--page-w', cfg.pageW + 'mm');
  raiz.setProperty('--page-h', cfg.pageH + 'mm');
  raiz.setProperty('--margem', cfg.margem + 'mm');
  raiz.setProperty('--gap', cfg.espaco + 'mm');
  raiz.setProperty('--cols', String(cfg.cols));
  raiz.setProperty('--rows', String(cfg.rows));
  raiz.setProperty('--card-w', w + 'mm');
  raiz.setProperty('--card-h', h + 'mm');
  raiz.setProperty('--qr-size', 'calc(var(--card-w) * 0.34)');
  raiz.setProperty('--escala', String(cfg.escala));
  $('page-size').textContent = '@page { size: ' + cfg.pageW + 'mm ' + cfg.pageH + 'mm; margin: 0; }';
  return { w, h, reduzida };
}

/* ------------------------------------------------------------------ *
 * Seleção das cartas
 * ------------------------------------------------------------------ */

function selecionarCartas(cfg) {
  const status = cfg.rascunho ? ['approved', 'wait'] : ['approved'];
  // Sobre as cartas efetivas: o filtro por tema usa o tópico já renomeado/atribuído.
  let lista = filterCards(cartasEfetivas(), { topics: cfg.temas, status, search: cfg.busca });
  lista = arrange(lista, { order: cfg.ordem, seed: cfg.seed });
  if (cfg.copias > 1) {
    const repetido = [];
    for (let i = 0; i < cfg.copias; i++) repetido.push(...lista);
    lista = repetido;
  }
  if (cfg.quantidade !== 'todas') lista = lista.slice(0, Number(cfg.quantidade));
  return lista;
}

/* ------------------------------------------------------------------ *
 * Cartas
 * ------------------------------------------------------------------ */

// `textoData` vem de lib/deck.mjs — a impressão e o jogo mostram a data do
// mesmo jeito, sem duas implementações divergindo.

function indiceDaCarta(card, cfg, canto) {
  const caixa = criar('div', 'card__indice' + (canto === 'br' ? ' card__indice--br' : ''));
  let simbolo = '♠';
  let cor = 'preto';
  if (cfg.simbolos === 'tema') {
    // Usa o tópico efetivo (próprio ou renomeado), não o tema original dos dados.
    const tema = card._topico || TEMA_POR_SLUG.get(normalize(card.topic));
    if (tema?.simbolo) {
      simbolo = tema.simbolo;
      cor = tema.cor || 'preto';
    }
  }
  const rank = criar('span', 'card__rank', String(card.numeroNaCarta ?? card.id ?? '?'));
  const naipe = criar('span', 'card__suit' + (cor === 'vermelho' ? ' card__suit--vermelho' : ''), simbolo);
  caixa.append(rank, naipe);
  return caixa;
}

function montarCarta(card, face, cfg) {
  const rascunho = card.status !== 'approved';
  const el = criar('div', 'card card--' + (face === 'front' ? 'front' : 'back'));
  if (rascunho && cfg.tarja) el.classList.add('card--rascunho');

  if (face === 'front') {
    const pergunta = criar('p', 'card__pergunta');
    pergunta.append('Isso é', criar('br'), 'bom ou ruim?');

    const citacao = criar('blockquote', 'card__citacao');
    citacao.append(criar('span', null, '“' + card.quote + '”'));

    const tema = criar('p', 'card__tema', '#' + (card.topic || 'geral'));

    el.append(pergunta, citacao, tema);

    const data = criar('p', 'card__data', textoData(card));
    el.append(data);

    el.append(indiceDaCarta(card, cfg, 'tl'), indiceDaCarta(card, cfg, 'br'));
  } else {
    el.classList.add('has-selo');
    el.append(criar('p', 'card__autor', card.autor || 'Autoria não confirmada'));

    const cargo = [card.cargo, card.partido].filter(Boolean).join(' · ');
    if (cargo) el.append(criar('p', 'card__cargo', cargo));

    const meta = [textoData(card), card.veiculo].filter(Boolean).join(' · ');
    if (meta) el.append(criar('p', 'card__meta', meta));

    // Etiqueta do tema já com a camada do usuário: o tópico efetivo manda.
    const topicoEfetivo = card._topico;
    const rotuloTema =
      '#' + card.topic +
      (topicoEfetivo && normalize(topicoEfetivo.label) !== normalize(card.topic) ? ' · ' + topicoEfetivo.label : '');
    el.append(criar('p', 'card__tags', rotuloTema));

    if (cfg.qr || cfg.link) {
      const fonte = criar('div', 'card__fonte');

      if (cfg.qr) {
        if (card.link) {
          const caixaQr = criar('div', 'card__qr');
          caixaQr.innerHTML = qrSvg(card.link, {
            ecc: 'M',
            border: 2,
            title: 'Fonte: ' + card.link,
          });
          fonte.append(caixaQr);
        } else {
          fonte.append(criar('div', 'card__qr card__qr--vazio', 'fonte não anexada'));
        }
      }

      if (cfg.link) {
        const caixa = criar('div', 'card__linkbox');
        caixa.append(criar('p', 'card__link-rotulo', card.link ? 'Fonte oficial' : 'Sem fonte'));
        caixa.append(
          criar('p', 'card__link-url' + (card.link ? '' : ' card__link-url--vazio'), card.link || 'fonte ainda não anexada')
        );
        fonte.append(caixa);
      }

      el.append(fonte);
    }

    el.append(
      criar(
        'p',
        'card__selo',
        card.status === 'approved' ? 'fonte verificada' : 'não verificado · revisar antes de divulgar'
      )
    );

    el.append(indiceDaCarta(card, cfg, 'tl'));
  }

  // A tarja de rascunho fica só na frente, no canto — no verso quem avisa é o selo.
  if (face === 'front' && rascunho && cfg.tarja) {
    el.append(criar('div', 'card__tarja', 'não verificado'));
  }
  return el;
}

/* ------------------------------------------------------------------ *
 * Folhas
 * ------------------------------------------------------------------ */

function montarFolhas(cartas, cfg) {
  const porFolha = cfg.cols * cfg.rows;
  const alvo = $('folhas');
  alvo.innerHTML = '';
  const paginas = [];

  if (cfg.modo === 'recortar-colar') {
    const sequencia = [];
    for (const card of cartas) {
      sequencia.push({ card, face: 'front' });
      sequencia.push({ card, face: 'back' });
    }
    const grupos = chunk(padToMultiple(sequencia, porFolha), porFolha);
    grupos.forEach((grupo, i) => paginas.push({ face: 'misto', slots: grupo, indice: i + 1, total: grupos.length }));
  } else {
    const grupos = chunk(padToMultiple(cartas, porFolha), porFolha);
    grupos.forEach((grupo, i) => {
      const total = grupos.length;
      const paraSlot = (face) => (c) => (c ? { card: c, face } : null);
      if (cfg.modo === 'duplex') {
        paginas.push({ face: 'front', slots: grupo.map(paraSlot('front')), indice: i + 1, total });
        const espelho = mirrorForDuplex(grupo, cfg.cols, cfg.rows, cfg.borda);
        paginas.push({ face: 'back', slots: espelho.map(paraSlot('back')), indice: i + 1, total });
      } else if (cfg.modo === 'frente') {
        paginas.push({ face: 'front', slots: grupo.map(paraSlot('front')), indice: i + 1, total });
      } else {
        const espelho = mirrorForDuplex(grupo, cfg.cols, cfg.rows, cfg.borda);
        paginas.push({ face: 'back', slots: espelho.map(paraSlot('back')), indice: i + 1, total });
      }
    });
  }

  for (const pagina of paginas) alvo.append(montarFolha(pagina, cfg));
  return paginas;
}

function montarFolha(pagina, cfg) {
  const folha = criar('div', 'folha');
  const sheet = criar('div', 'sheet');
  sheet.dataset.marcas = cfg.marcas;
  sheet.dataset.face = pagina.face;

  const grade = criar('div', 'sheet__grid');
  for (const slot of pagina.slots) {
    grade.append(slot ? montarCarta(slot.card, slot.face, cfg) : criar('div', 'card card--vazia'));
  }
  sheet.append(grade);

  if (cfg.rodape) {
    const rodape = criar('div', 'sheet__rodape');
    const rotulo = pagina.face === 'front' ? 'frente' : pagina.face === 'back' ? 'verso' : 'frente + verso';
    rodape.append(
      criar('span', null, 'Baralho · ' + rotulo + (cfg.modo === 'verso' ? ' (espelhado para casar com as frentes)' : '')),
      criar('span', null, 'folha ' + pagina.indice + '/' + pagina.total)
    );
    sheet.append(rodape);
  }

  folha.append(sheet);
  return folha;
}

function ajustarCitacoes() {
  for (const caixa of document.querySelectorAll('.card__citacao')) {
    const texto = caixa.firstElementChild;
    if (!texto) continue;
    let tamanho = 1.12;
    caixa.style.fontSize = tamanho + 'em';
    let voltas = 0;
    while (texto.offsetHeight > caixa.clientHeight && tamanho > 0.5 && voltas++ < 60) {
      tamanho -= 0.04;
      caixa.style.fontSize = tamanho.toFixed(2) + 'em';
    }
  }
}

/* ------------------------------------------------------------------ *
 * Folhas de teste de alinhamento
 * ------------------------------------------------------------------ */

function montarTeste(cfg) {
  const alvo = $('teste-folhas');
  alvo.innerHTML = '';
  const porFolha = cfg.cols * cfg.rows;

  for (const face of ['front', 'back']) {
    const folha = criar('div', 'folha');
    const sheet = criar('div', 'sheet');
    sheet.dataset.marcas = 'tracejada';

    const grade = criar('div', 'sheet__grid');
    // O verso leva os mesmos números do que a impressão real: espelhados. Assim,
    // se VERSO 3 cair atrás de FRENTE 3, o alinhamento está certo.
    const rotulos = Array.from({ length: porFolha }, (_, i) => i + 1);
    const ordem = face === 'back' ? mirrorForDuplex(rotulos, cfg.cols, cfg.rows, cfg.borda) : rotulos;
    for (let i = 0; i < porFolha; i++) {
      const slot = criar('div', 'teste__slot');
      slot.append(criar('strong', null, (face === 'front' ? 'FRENTE' : 'VERSO') + ' ' + ordem[i]));
      slot.append(criar('span', null, face === 'front' ? 'citação · frente' : 'autor + fonte · verso'));
      grade.append(slot);
    }
    sheet.append(grade);

    for (const canto of ['tl', 'tr', 'bl', 'br']) sheet.append(criar('div', 'reg reg--' + canto));

    const rodape = criar('div', 'sheet__rodape');
    rodape.append(
      criar('span', null, 'teste de alinhamento · ' + (face === 'front' ? 'frente' : 'verso')),
      criar('span', null, 'se as cruzetas coincidirem ao segurar a folha contra a luz, está alinhado')
    );
    sheet.append(rodape);

    folha.append(sheet);
    alvo.append(folha);
  }
}

function imprimirTeste() {
  const cfg = lerConfig();
  montarTeste(cfg);
  document.body.classList.add('imprimindo-teste');
  const restaurar = () => {
    document.body.classList.remove('imprimindo-teste');
    window.removeEventListener('afterprint', restaurar);
  };
  window.addEventListener('afterprint', restaurar);
  window.print();
  setTimeout(restaurar, 60000);
}

/* ------------------------------------------------------------------ *
 * Avisos e resumo
 * ------------------------------------------------------------------ */

function mostrarAviso(texto, tipo) {
  const caixa = $('aviso');
  if (!texto) {
    caixa.hidden = true;
    caixa.textContent = '';
    return;
  }
  caixa.hidden = false;
  caixa.className = 'aviso' + (tipo === 'erro' ? ' aviso--erro' : '');
  caixa.textContent = texto;
}

function atualizarResumo(cartasVisiveis, cfg, geometria, paginas) {
  const aprovadas = CARTAS.filter((c) => c.status === 'approved').length;
  const rascunho = CARTAS.filter((c) => c.status === 'wait').length;
  const rejeitadas = CARTAS.filter((c) => c.status === 'reject').length;

  $('resumo').textContent =
    cartasVisiveis.length + ' cartas · ' + paginas.length + ' página(s) · ' +
    aprovadas + ' aprovada(s), ' + rascunho + ' em rascunho' +
    (rejeitadas ? ', ' + rejeitadas + ' rejeitada(s) (fora da impressão)' : '') +
    (OVERLAY.proprios.length || Object.keys(OVERLAY.renomeados).length
      ? ' · tópicos do usuário ativos'
      : '');

  const resumoMobile = $('resumo-mobile');
  if (resumoMobile) {
    resumoMobile.textContent =
      cartasVisiveis.length + ' cartas · ' + paginas.length + ' pág.' +
      (aprovadas ? '' : ' · rascunho');
  }

  const avisos = [];
  if (!cartasVisiveis.length) {
    avisos.push('Nenhuma carta corresponde aos filtros atuais.');
  }
  const imprimindoRascunho = cartasVisiveis.some((c) => c.status !== 'approved');
  if (imprimindoRascunho && !cfg.tarja) {
    avisos.push(
      'Atenção: há cartas não verificadas nesta tiragem e a tarja está desligada. Ligue a tarja ou inclua apenas cartas aprovadas — sem isso, uma atribuição não checada vira material impresso.'
    );
  } else if (imprimindoRascunho) {
    avisos.push(
      cartasVisiveis.filter((c) => c.status !== 'approved').length +
        ' carta(s) ainda NÃO VERIFICADA(S) (sem fonte primária anexada): a tiragem é de rascunho, com tarja. Use para revisão e checagem de atribuição, não para distribuir.'
    );
  }
  if (geometria?.reduzida) {
    avisos.push('O tamanho escolhido não cabia na folha: as cartas foram reduzidas proporcionalmente.');
  }
  if (!cartasVisiveis.length && !CARTAS.length) {
    avisos.push('Nenhum dado carregado. Rode `node web/server.mjs` e abra /print.html.');
  }
  mostrarAviso(avisos.join(' '), cartasVisiveis.some((c) => c.status !== 'approved') && !cfg.tarja ? 'erro' : null);
}

function atualizarDica(cfg) {
  const dicas = {
    duplex:
      'Frente e verso alternam na mesma tiragem, com o verso espelhado para casar com as frentes. Na impressora, escolha "Imprimir frente e verso" e a borda ' +
      (cfg.borda === 'longa' ? 'longa' : 'curta') +
      '. Faça o teste de alinhamento antes de gastar papel.',
    frente:
      'Sai só a frente (a pergunta e a citação). Serve para o jogo, para revelar o autor em separado ou para uma tiragem de frente antes do verso.',
    verso:
      'Sai só o verso, já espelhado para casar com as frentes impressas antes. Recoloque as folhas na mesma posição e imprima.',
    'recortar-colar':
      'Frente e verso ficam lado a lado na mesma face: recorte, dobre ao meio e cole. Para quem não tem impressão duplex.',
  };
  $('dica-modo').textContent = dicas[cfg.modo] || '';
  $('borda').disabled = cfg.modo === 'frente' || cfg.modo === 'recortar-colar';
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function render() {
  const cfg = lerConfig();
  const geometria = aplicarGeometria(cfg);
  const cartas = selecionarCartas(cfg);
  const paginas = montarFolhas(cartas, cfg);
  ajustarCitacoes();
  atualizarDica(cfg);
  atualizarResumo(cartas, cfg, geometria, paginas);
  $('vazio').hidden = cartas.length > 0;
  if (!cartas.length) {
    $('vazio').textContent = CARTAS.length
      ? 'Nenhuma carta com os filtros atuais. Limpe a busca, troque os temas ou ligue o modo rascunho.'
      : 'Não foi possível carregar as cartas. Rode `node web/server.mjs` e abra http://127.0.0.1:4178/print.html';
  }
  for (const id of ['margem', 'espaco', 'escala']) {
    const out = $(id + '-out');
    if (out) out.textContent = $(id).value;
  }
}

/* ------------------------------------------------------------------ *
 * Celular: abas, escala que caiba na tela e barra fixa de ação
 * ------------------------------------------------------------------ */

let escalaManual = false;

function ajustarEscalaATela() {
  const preview = document.querySelector('.preview');
  const disponivel = (preview?.clientWidth || document.documentElement.clientWidth) - 24;
  const larguraFolha = lerConfig().pageW * 3.7795275591; // mm → px (96 dpi)
  const proporcao = Math.min(1, Math.max(0.15, disponivel / larguraFolha));
  // Arredonda para BAIXO de propósito: a folha precisa caber, não quase caber.
  $('escala').value = String(Math.max(15, Math.floor(proporcao * 100)));
}

function ligarCelular() {
  const layout = document.querySelector('.layout');
  layout.dataset.aba = 'ajustes';

  for (const botao of document.querySelectorAll('.aba')) {
    botao.addEventListener('click', () => {
      layout.dataset.aba = botao.dataset.aba;
      for (const outro of document.querySelectorAll('.aba')) {
        outro.setAttribute('aria-selected', String(outro === botao));
      }
      if (botao.dataset.aba === 'previa' && !escalaManual) {
        ajustarEscalaATela();
        render();
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // As abas grudam logo abaixo da barra do topo, cuja altura pode variar.
  const topbar = document.querySelector('.topbar');
  const medirTopbar = () => document.documentElement.style.setProperty('--topbar-h', topbar.offsetHeight + 'px');
  medirTopbar();
  if (window.ResizeObserver) new ResizeObserver(medirTopbar).observe(topbar);

  $('ajustar-tela').addEventListener('click', () => {
    escalaManual = false;
    ajustarEscalaATela();
    render();
  });

  $('escala').addEventListener('input', () => {
    escalaManual = true;
  });

  const botaoMobile = $('imprimir-mobile');
  if (botaoMobile) botaoMobile.addEventListener('click', () => window.print());

  let temporizador = 0;
  window.addEventListener('resize', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      medirTopbar();
      if (!escalaManual && matchMedia('(max-width: 860px)').matches) {
        ajustarEscalaATela();
        render();
      }
    }, 180);
  });
}

/* ------------------------------------------------------------------ *
 * Opções por URL — permite mandar a configuração de impressão para alguém
 * ------------------------------------------------------------------ */

const CAMPOS_URL = ['papel', 'porFolha', 'tamanho', 'margem', 'espaco', 'marcas', 'modo', 'borda',
  'simbolos', 'escala', 'ordem', 'seed', 'copias', 'quantidade', 'busca'];
const CHAVES_URL = ['rodape', 'qr', 'link', 'tarja', 'rascunho'];

function aplicarParametros() {
  const q = new URLSearchParams(location.search);
  for (const id of CAMPOS_URL) {
    const valor = q.get(id);
    if (valor !== null && $(id)) $(id).value = valor;
  }
  for (const id of CHAVES_URL) {
    const valor = q.get(id);
    if (valor !== null && $(id)) $(id).checked = valor === '1' || valor === 'true';
  }
  const temas = q.get('temas');
  if (temas) for (const t of temas.split(',').map((s) => s.trim()).filter(Boolean)) temasSelecionados.add(t);
}

function linkDasOpcoes() {
  const q = new URLSearchParams();
  for (const id of CAMPOS_URL) if ($(id).value) q.set(id, $(id).value);
  for (const id of CHAVES_URL) if (!$(id).checked) q.set(id, '0');
  if (temasSelecionados.size) q.set('temas', [...temasSelecionados].join(','));
  return location.origin + location.pathname + '?' + q.toString();
}

/* ------------------------------------------------------------------ *
 * Controles
 * ------------------------------------------------------------------ */

function ligarControles() {
  const reativos = ['busca', 'rascunho', 'quantidade', 'ordem', 'seed', 'copias', 'papel', 'porFolha',
    'tamanho', 'margem', 'espaco', 'marcas', 'rodape', 'modo', 'borda', 'qr', 'link', 'tarja', 'simbolos', 'escala'];
  for (const id of reativos) {
    const el = $(id);
    el.addEventListener('input', render);
    el.addEventListener('change', render);
  }

  $('temas-todos').addEventListener('click', () => {
    for (const t of listaDeTopicos()) temasSelecionados.add(t.slug);
    montarChips();
    render();
  });
  $('temas-nenhum').addEventListener('click', () => {
    temasSelecionados.clear();
    montarChips();
    render();
  });

  $('imprimir').addEventListener('click', () => window.print());
  $('teste').addEventListener('click', imprimirTeste);
  $('copiar-link').addEventListener('click', async () => {
    const link = linkDasOpcoes();
    try {
      await navigator.clipboard.writeText(link);
      $('copiar-link').textContent = 'Link copiado ✓';
    } catch {
      $('copiar-link').textContent = link;
    }
    setTimeout(() => ($('copiar-link').textContent = 'Copiar link destas opções'), 2500);
  });

  $('reset').addEventListener('click', () => {
    for (const [id, valor] of Object.entries(PADROES)) {
      const el = $(id);
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = valor;
      else el.value = valor;
    }
    escalaManual = false;
    temasSelecionados.clear();
    montarChips();
    render();
  });

  window.addEventListener('afterprint', () => document.body.classList.remove('imprimindo-teste'));
}

/* ------------------------------------------------------------------ *
 * Início
 * ------------------------------------------------------------------ */

ligarControles();
ligarCelular();
aplicarParametros();
carregar()
  .then(() => {
    if (matchMedia('(max-width: 860px)').matches) ajustarEscalaATela();
    render();
    // /print.html?teste=1 já mostra (e imprime) as folhas de teste de alinhamento.
    if (new URLSearchParams(location.search).get('teste') === '1') {
      montarTeste(lerConfig());
      document.body.classList.add('imprimindo-teste');
      const sair = () => {
        document.body.classList.remove('imprimindo-teste');
        window.removeEventListener('afterprint', sair);
      };
      window.addEventListener('afterprint', sair);
    }
  })
  .catch((err) => {
    mostrarAviso('Falha ao carregar as cartas: ' + err.message + ' — rode `node web/server.mjs`.', 'erro');
    $('resumo').textContent = 'sem dados';
    render();
  });
