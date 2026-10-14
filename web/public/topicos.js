/**
 * Editor de tópicos: renomear temas, criar tópicos próprios e atribuir cartas.
 *
 * Tudo é gravado no aparelho (localStorage) — nada vai para servidor. A mesma
 * camada é lida pelo estúdio de impressão, então o tópico renomeado aparece no
 * chip, no filtro e na etiqueta `#` da carta impressa.
 */

import {
  overlayVazio,
  slugificar,
  slugUnico,
  slugsEmUso,
  listarTopicos,
  resolverTopico,
  proximoId,
} from './lib/topics.mjs';
import {
  lerOverlay,
  gravarOverlay,
  limparOverlay,
  exportarOverlay,
  importarOverlay,
  disponivel,
} from './lib/store.mjs';

const $ = (id) => document.getElementById(id);
const criar = (tag, classe, texto) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto != null) el.textContent = texto;
  return el;
};

let CARTAS = [];
let TEMAS = [];
let POR_SLUG = new Map();
let overlay = overlayVazio();
const selecionadas = new Set();

/* ------------------------------------------------------------------ *
 * Carga
 * ------------------------------------------------------------------ */

async function iniciar() {
  const buscar = async (rotas) => {
    for (const r of rotas) {
      try {
        const res = await fetch(r, { cache: 'no-store' });
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    throw new Error('Não foi possível carregar dados de ' + rotas[0]);
  };

  const [dadosCartas, dadosTemas] = await Promise.all([
    buscar(['/api/cards?draft=1', './api/cards?draft=1', './api/cards.json', './data/cards.seed.json']),
    buscar(['/api/topics', './api/topics', './api/topics.json', './data/topics.json']).catch(() => ({ temas: [] })),
  ]);

  CARTAS = dadosCartas.cards || [];
  TEMAS = dadosTemas.temas || [];
  POR_SLUG = new Map(TEMAS.map((t) => [t.slug, t]));
  overlay = lerOverlay();
  ligar();
  render();
}

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */

/** Tópico que a carta teria sem atribuição explícita (respeitando renomeações). */
function topicoOriginal(card) {
  const semAtribuicao = { ...overlay, atribuicoes: { ...overlay.atribuicoes } };
  delete semAtribuicao.atribuicoes[card.id];
  return resolverTopico(card, semAtribuicao, POR_SLUG);
}

const topicos = () => listarTopicos(CARTAS, overlay, TEMAS);

function salvar() {
  const ok = gravarOverlay(overlay);
  if (!ok) mostrarAviso('Não foi possível gravar neste navegador (modo privado?). As mudanças valem só nesta aba.', 'erro');
}

function mostrarAviso(texto, tipo) {
  const caixa = $('aviso');
  if (!texto) {
    caixa.hidden = true;
    return;
  }
  caixa.hidden = false;
  caixa.className = 'aviso' + (tipo === 'erro' ? ' aviso--erro' : '');
  caixa.textContent = texto;
}

/* ------------------------------------------------------------------ *
 * Cartas visíveis na lista
 * ------------------------------------------------------------------ */

function cartasVisiveis() {
  const busca = $('busca').value.trim().toLowerCase();
  const status = $('filtro-status').value;
  const filtroTopico = $('filtro-topico').value;
  const soSemProprio = $('so-sem-proprio').checked;

  return CARTAS.filter((card) => {
    if (status !== 'todas' && card.status !== status) return false;
    if (soSemProprio && overlay.atribuicoes[card.id]) return false;
    if (filtroTopico && resolverTopico(card, overlay, POR_SLUG).slug !== filtroTopico) return false;
    if (busca) {
      const alvo = [card.quote, card.autor, card.id, card.topic].filter(Boolean).join(' ').toLowerCase();
      if (!alvo.includes(busca)) return false;
    }
    return true;
  });
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

function render() {
  renderTopicos();
  renderFiltroTopico();
  renderAlvoAtribuicao();
  renderCartas();
  atualizarResumo();
}

function renderTopicos() {
  const caixa = $('lista-topicos');
  caixa.innerHTML = '';

  for (const tema of TEMAS) {
    const renomeado = overlay.renomeados[tema.slug];
    caixa.append(
      linhaTopico({
        chave: tema.slug,
        label: renomeado?.label || tema.label,
        slug: renomeado?.slug || tema.slug,
        simbolo: tema.simbolo,
        cor: tema.cor,
        proprio: false,
      })
    );
  }
  for (const tema of overlay.proprios) {
    caixa.append(
      linhaTopico({ chave: tema.id, label: tema.label, slug: tema.slug, simbolo: tema.simbolo, cor: tema.cor, proprio: true })
    );
  }
}

function linhaTopico({ chave, label, slug, simbolo, cor, proprio }) {
  const linha = criar('div', 'topico-linha' + (proprio ? ' topico-linha--proprio' : ''));
  linha.dataset.chave = chave;
  linha.dataset.proprio = proprio ? '1' : '0';

  const simboloEl = criar('div', 'topico-linha__simbolo' + (cor === 'vermelho' ? ' topico-linha__simbolo--vermelho' : ''), simbolo);
  linha.append(simboloEl);

  const nome = document.createElement('input');
  nome.type = 'text';
  nome.className = 'topico-linha__nome';
  nome.value = label;
  nome.maxLength = 60;
  nome.setAttribute('aria-label', 'Nome do tópico ' + chave);
  nome.addEventListener('input', () => {
    if (proprio) {
      overlay.proprios.find((t) => t.id === chave).label = nome.value;
    } else {
      const atual = overlay.renomeados[chave] || { label: chave, slug: chave };
      overlay.renomeados[chave] = { ...atual, label: nome.value };
    }
    salvar();
    atualizarResumo();
  });
  nome.addEventListener('change', render);
  linha.append(nome);

  const etiqueta = document.createElement('input');
  etiqueta.type = 'text';
  etiqueta.value = slug;
  etiqueta.maxLength = 40;
  etiqueta.setAttribute('aria-label', 'Etiqueta da carta para ' + chave);
  etiqueta.addEventListener('change', () => {
    const usados = slugsEmUso(overlay, TEMAS);
    usados.delete(slug); // o próprio slug não conta como conflito
    const novo = slugUnico(etiqueta.value || label, usados);
    if (proprio) {
      overlay.proprios.find((t) => t.id === chave).slug = novo;
    } else {
      const atual = overlay.renomeados[chave] || { label: chave, slug: chave };
      overlay.renomeados[chave] = { ...atual, slug: novo };
    }
    salvar();
    render();
  });

  // O "#" deixa claro que este campo é a etiqueta que sai impressa na carta.
  const caixaEtiqueta = criar('div', 'topico-linha__etiqueta');
  caixaEtiqueta.append(criar('span', null, '#'));
  caixaEtiqueta.append(etiqueta);
  linha.append(caixaEtiqueta);

  const contagem = topicos().find((t) => t.chave === chave);
  linha.append(criar('div', 'topico-linha__contagem', (contagem?.total || 0) + ' carta(s)'));

  const acoes = criar('div', 'topico-linha__acoes');
  if (proprio) {
    const excluir = criar('button', 'mini mini--perigo', 'excluir');
    excluir.type = 'button';
    excluir.addEventListener('click', () => excluirTopico(chave));
    acoes.append(excluir);
  }
  linha.append(acoes);
  return linha;
}

function renderFiltroTopico() {
  const select = $('filtro-topico');
  const atual = select.value;
  select.innerHTML = '';
  select.append(new Option('todos os tópicos', ''));
  for (const t of topicos()) select.append(new Option('#' + t.slug + ' — ' + t.label + ' (' + t.total + ')', t.slug));
  select.value = atual;
  if (select.value !== atual) select.value = '';
}

function renderAlvoAtribuicao() {
  const select = $('alvo-atribuicao');
  const atual = select.value;
  select.innerHTML = '';
  for (const t of topicos()) {
    select.append(new Option('#' + t.slug + ' — ' + t.label + (t.proprio ? ' (próprio)' : ''), t.chave));
  }
  if (atual && [...select.options].some((o) => o.value === atual)) select.value = atual;
}

function renderCartas() {
  const caixa = $('lista-cartas');
  caixa.innerHTML = '';
  const visiveis = cartasVisiveis();

  if (!visiveis.length) {
    caixa.append(criar('p', 'dica', 'Nenhuma carta com esses filtros.'));
  }

  for (const card of visiveis) {
    const original = topicoOriginal(card);
    const atribuido = overlay.atribuicoes[card.id];
    const efetivo = resolverTopico(card, overlay, POR_SLUG);

    const linha = criar('label', 'carta-linha' + (selecionadas.has(card.id) ? ' marcada' : ''));
    linha.dataset.card = card.id;

    const caixaSel = document.createElement('input');
    caixaSel.type = 'checkbox';
    caixaSel.checked = selecionadas.has(card.id);
    caixaSel.addEventListener('change', () => {
      if (caixaSel.checked) selecionadas.add(card.id);
      else selecionadas.delete(card.id);
      linha.classList.toggle('marcada', caixaSel.checked);
      atualizarSelecao();
    });
    linha.append(caixaSel);

    linha.append(criar('span', 'carta-linha__num', String(card.numeroNaCarta ?? card.id)));

    linha.append(
      criar(
        'span',
        'selo-status selo-status--' + (card.status === 'approved' ? 'approved' : 'wait'),
        card.status === 'approved' ? 'verificada' : 'rascunho'
      )
    );

    const citacao = criar('span', 'carta-linha__citacao');
    citacao.append(criar('span', null, '“' + card.quote + '” '));
    citacao.append(criar('span', 'carta-linha__autor', '— ' + (card.autor || 'sem autor')));
    citacao.title = card.quote;
    linha.append(citacao);

    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Tópico da carta ' + card.id);
    select.append(new Option('original: #' + original.slug, ''));
    for (const t of topicos()) {
      select.append(new Option('#' + t.slug + ' — ' + t.label + (t.proprio ? ' (próprio)' : ''), t.chave));
    }
    select.value = atribuido || '';
    if (select.value !== (atribuido || '')) select.value = '';
    select.addEventListener('change', () => {
      if (!select.value) delete overlay.atribuicoes[card.id];
      else overlay.atribuicoes[card.id] = select.value;
      salvar();
      render();
    });
    linha.append(select);

    if (atribuido && efetivo.proprio) linha.title = 'Tópico próprio: ' + efetivo.label;
    caixa.append(linha);
  }

  $('resumo-cartas').textContent =
    visiveis.length + ' de ' + CARTAS.length + ' cartas · ' +
    Object.keys(overlay.atribuicoes).length + ' com tópico atribuído à mão';
  atualizarSelecao();
}

function atualizarResumo() {
  const proprios = overlay.proprios.length;
  const renomeados = Object.keys(overlay.renomeados).length;
  $('resumo').textContent =
    CARTAS.length + ' cartas · ' + renomeados + ' tema(s) renomeado(s) · ' + proprios + ' tópico(s) próprio(s) · ' +
    (disponivel() ? 'salvo neste navegador' : 'sem armazenamento local');
}

function atualizarSelecao() {
  const n = selecionadas.size;
  $('contagem-selecionadas').textContent = n ? n + ' carta(s) selecionada(s)' : 'nenhuma carta selecionada';
  $('aplicar').disabled = n === 0;
  $('limpar-atribuicao').disabled = n === 0;
  // No celular, o grupo de atribuição vira uma barra fixa — só quando faz sentido.
  document.body.classList.toggle('tem-selecao', n > 0);
}

/* ------------------------------------------------------------------ *
 * Ações
 * ------------------------------------------------------------------ */

function criarTopico() {
  const nome = $('novo-nome').value.trim();
  if (!nome) {
    $('novo-nome').focus();
    return;
  }
  const usados = slugsEmUso(overlay, TEMAS);
  const id = proximoId(overlay);
  overlay.proprios.push({
    id,
    label: nome,
    slug: slugUnico(nome, usados),
    simbolo: $('novo-simbolo').value,
    cor: $('novo-cor').value,
  });
  $('novo-nome').value = '';
  salvar();
  render();
}

function excluirTopico(id) {
  const tema = overlay.proprios.find((t) => t.id === id);
  if (!tema) return;
  const quantas = Object.values(overlay.atribuicoes).filter((c) => c === id).length;
  const aviso = quantas
    ? 'Excluir o tópico "' + tema.label + '"? ' + quantas + ' carta(s) voltam ao tópico original.'
    : 'Excluir o tópico "' + tema.label + '"?';
  if (!window.confirm(aviso)) return;
  overlay.proprios = overlay.proprios.filter((t) => t.id !== id);
  for (const [cardId, chave] of Object.entries(overlay.atribuicoes)) {
    if (chave === id) delete overlay.atribuicoes[cardId];
  }
  salvar();
  render();
}

function aplicarAsSelecionadas() {
  const alvo = $('alvo-atribuicao').value;
  if (!alvo || !selecionadas.size) return;
  for (const cardId of selecionadas) overlay.atribuicoes[cardId] = alvo;
  salvar();
  render();
}

function limparAtribuicaoDasSelecionadas() {
  if (!selecionadas.size) return;
  for (const cardId of selecionadas) delete overlay.atribuicoes[cardId];
  salvar();
  render();
}

function exportar() {
  const conteudo = exportarOverlay(overlay);
  const blob = new Blob([conteudo], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'baralho-topicos.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function importar(arquivo) {
  try {
    overlay = importarOverlay(await arquivo.text());
    salvar();
    render();
  } catch (err) {
    mostrarAviso('Não consegui ler esse arquivo: ' + err.message, 'erro');
  }
}

function restaurar() {
  if (!window.confirm('Voltar à taxonomia original? Os tópicos próprios, renomeações e atribuições serão apagados.')) return;
  limparOverlay();
  overlay = overlayVazio();
  selecionadas.clear();
  render();
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */

function ligar() {
  $('criar-topico').addEventListener('click', criarTopico);
  $('novo-nome').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') criarTopico();
  });
  $('novo-nome').addEventListener('input', () => {
    const nome = $('novo-nome').value.trim();
    $('previa-slug').textContent = nome ? 'etiqueta da carta: #' + slugUnico(nome, slugsEmUso(overlay, TEMAS)) : '—';
  });

  for (const id of ['busca', 'filtro-status', 'filtro-topico', 'so-sem-proprio']) {
    $(id).addEventListener('input', renderCartas);
    $(id).addEventListener('change', renderCartas);
  }

  $('sel-todas').addEventListener('click', () => {
    for (const card of cartasVisiveis()) selecionadas.add(card.id);
    renderCartas();
  });
  $('sel-nenhuma').addEventListener('click', () => {
    selecionadas.clear();
    renderCartas();
  });

  $('aplicar').addEventListener('click', aplicarAsSelecionadas);
  $('limpar-atribuicao').addEventListener('click', limparAtribuicaoDasSelecionadas);
  $('exportar').addEventListener('click', exportar);
  $('restaurar').addEventListener('click', restaurar);
  $('arquivo').addEventListener('change', (e) => {
    if (e.target.files?.[0]) importar(e.target.files[0]);
    e.target.value = '';
  });
  $('imprimir-lista').addEventListener('click', () => window.print());
}

iniciar().catch((err) => {
  mostrarAviso('Falha ao carregar: ' + err.message + ' — rode `node web/server.mjs`.', 'erro');
  $('resumo').textContent = 'sem dados';
});
