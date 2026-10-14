#!/usr/bin/env node
/**
 * Testes do baralho — zero dependências (`node baralho-app/test/smoke.mjs`).
 *
 * Cobre: integridade do conjunto de dados, regras do schema, operações de
 * baralho, estrutura do QR Code (com regressão congelada) e as rotas do servidor,
 * incluindo a regra dura de que carta não aprovada não sai sem `draft=1`.
 *
 * A verificação do encoder contra uma implementação independente fica em
 * `tools/verify-qr.mjs` (precisa de node_modules — não é o caso aqui).
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeQR, qrSvg, pickVersion, numDataCodewords, alignmentPositions, rsBlockStructure } from '../lib/qr.mjs';
import { parseCsv, paraObjetos, escreverCsv, campoCsv } from '../lib/csv.mjs';
import { shuffle, filterCards, arrange, chunk, padToMultiple, mirrorForDuplex, normalize, hashSeed, textoData } from '../lib/deck.mjs';
import {
  montarBaralho, novaSessao, cartaAtual, restantes, acabou, avancar, retroceder, reembaralhar,
} from '../lib/jogo.mjs';
import {
  lerOverlay, gravarOverlay, limparOverlay, exportarOverlay, importarOverlay, disponivel, CHAVE_OVERLAY,
} from '../lib/store.mjs';
import {
  overlayVazio, slugificar, slugUnico, normalizarOverlay, resolverTopico,
  aplicarOverlay, listarTopicos, slugsEmUso, proximoId,
} from '../lib/topics.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.BARALHO_TEST_PORT || 4179);

let passou = 0;
const falhas = [];

function ok(condicao, rotulo, detalhe = '') {
  if (condicao) {
    passou++;
  } else {
    falhas.push(rotulo + (detalhe ? ' — ' + detalhe : ''));
  }
}
const igual = (a, b, rotulo) => ok(a === b, rotulo, `esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`);

/* ------------------------------------------------------------------ *
 * 1. Dados
 * ------------------------------------------------------------------ */

const cardsSeed = JSON.parse(await readFile(join(APP, 'data', 'cards.seed.json'), 'utf8'));
const topics = JSON.parse(await readFile(join(APP, 'data', 'topics.json'), 'utf8'));

const OBRIGATORIOS = ['quote', 'link', 'topic', 'status', 'contributor', 'relevance'];
const STATUS = new Set(['approved', 'wait', 'reject']);
const slugs = new Set(topics.temas.map((t) => t.slug));

igual(cardsSeed.cards.length, 50, 'seed tem 50 cartas');
igual(new Set(cardsSeed.cards.map((c) => c.id)).size, 50, 'ids únicos');
igual(
  new Set(cardsSeed.cards.map((c) => c.numeroNaCarta)).size,
  50,
  'número da carta único'
);

for (const card of cardsSeed.cards) {
  for (const campo of OBRIGATORIOS) {
    ok(Object.hasOwn(card, campo), `${card.id} tem o campo obrigatório ${campo}`);
  }
  ok(STATUS.has(card.status), `${card.id} status válido`, card.status);
  ok(Number.isInteger(card.relevance) && card.relevance >= 1 && card.relevance <= 5, `${card.id} relevance 1–5`, card.relevance);
  ok(slugs.has(card.topic), `${card.id} tema existe na taxonomia`, card.topic);
  ok(String(card.quote).length >= 10 && String(card.quote).length <= 600, `${card.id} citação com 10–600 caracteres`);
  ok(card.link === null || /^https?:\/\//.test(card.link), `${card.id} link nulo ou http(s)`);
  ok(typeof card.autor === 'string' && card.autor.length > 2, `${card.id} tem autor nomeado`);
  ok(card.status !== 'approved' || card.link, `${card.id} aprovada exige link`);
  ok(card.status !== 'reject' || card.motivoRejeicao, `${card.id} rejeitada registra o motivo`);
}

ok(topics.temas.length >= 16, 'taxonomia tem pelo menos 16 temas');
igual(new Set(topics.temas.map((t) => t.slug)).size, topics.temas.length, 'slugs de tema únicos');
for (const t of topics.temas) {
  ok(t.label && t.simbolo && t.cor, `tema ${t.slug} tem label, símbolo e cor`);
}
// O seed não pode trazer autoria fora do baralho de referência sem revisão.
igual(
  cardsSeed.cards.filter((c) => c.status === 'approved').length,
  0,
  'nenhuma carta do seed entra como aprovada'
);

/* ------------------------------------------------------------------ *
 * 1b. Créditos e manifesto do app
 * ------------------------------------------------------------------ */

const creditos = JSON.parse(await readFile(join(APP, 'data', 'creditos.json'), 'utf8'));
const manifesto = JSON.parse(await readFile(join(APP, 'web', 'public', 'manifest.webmanifest'), 'utf8'));

ok(Boolean(creditos.titulo), 'créditos têm título');
ok(Array.isArray(creditos.blocos) && creditos.blocos.length >= 3, 'créditos têm blocos', String(creditos.blocos?.length));
ok(new Set(creditos.blocos.map((b) => b.id)).size === creditos.blocos.length, 'ids de bloco de crédito únicos');
for (const bloco of creditos.blocos) ok(Boolean(bloco.titulo), `bloco ${bloco.id} tem título`);

const blocoAutoria = creditos.blocos.find((b) => b.id === 'autoria');
ok(blocoAutoria?.pessoas?.length >= 1, 'créditos nomeiam quem desenvolveu');
ok(blocoAutoria.pessoas.some((p) => /Naveda/.test(p.nome)), 'autoria com o nome do autor');

// A referência ao baralho original é o que não pode faltar.
const blocoBaralho = creditos.blocos.find((b) => b.id === 'baralho');
ok(Boolean(blocoBaralho), 'há bloco do baralho de referência');
const textoBaralho = JSON.stringify(blocoBaralho || {});
ok(/Vira Voto/.test(textoBaralho), 'créditos citam o nome do baralho original');
ok(/regiane/i.test(textoBaralho), 'créditos citam a autoria indicada no original');
ok(/drive\.google\.com/.test(textoBaralho), 'créditos apontam a origem do original');
ok(Boolean(blocoBaralho?.ressalva), 'há ressalva sobre autoria/licença do original');
ok(creditos.blocos.some((b) => b.id === 'aviso'), 'há bloco de aviso');

// Enxuto de propósito: sem ficha técnica, sem blocos de detalhe.
ok(creditos.blocos.length <= 4, 'créditos ficam enxutos (até 4 blocos)', String(creditos.blocos.length));
ok(!JSON.stringify(creditos).includes('playwright'), 'créditos não listam software de teste');

igual(manifesto.short_name, 'Baralho', 'manifesto: short_name');
ok(Boolean(manifesto.start_url && manifesto.display), 'manifesto: start_url e display');
ok(Array.isArray(manifesto.icons) && manifesto.icons.length >= 3, 'manifesto declara ícones');
ok(manifesto.icons.some((i) => i.purpose === 'maskable'), 'manifesto tem ícone maskable');
// Ícone declarado no manifesto precisa existir de fato.
for (const icone of manifesto.icons) {
  const caminho = join(APP, 'web', 'public', icone.src.replace(/^\.\//, ''));
  ok(existsSync(caminho), `ícone do manifesto existe: ${icone.src}`);
}

/* ------------------------------------------------------------------ *
 * 2. Baralho
 * ------------------------------------------------------------------ */

igual(JSON.stringify(shuffle([1, 2, 3, 4, 5], 'fiap')), JSON.stringify(shuffle([1, 2, 3, 4, 5], 'fiap')), 'shuffle determinístico com a mesma seed');
ok(JSON.stringify(shuffle([1, 2, 3, 4, 5], 'a')) !== JSON.stringify(shuffle([1, 2, 3, 4, 5], 'b')), 'seeds diferentes → ordens diferentes');
igual(shuffle([1, 2, 3], 'x').length, 3, 'shuffle preserva o tamanho');
ok(/^[0-9a-f]{8}$/.test(hashSeed('qualquer').toString(16).padStart(8, '0')), 'hashSeed devolve 32 bits');

const aprovada = { quote: 'x'.repeat(20), autor: 'A', topic: 'saude', status: 'approved', id: 'C01', numeroNaCarta: 1 };
const espera = { quote: 'y'.repeat(20), autor: 'B', topic: 'educacao', status: 'wait', id: 'C02', numeroNaCarta: 2 };
const amostra = [aprovada, espera];

igual(filterCards(amostra, { status: ['approved'] }).length, 1, 'filtro padrão só aprovadas');
igual(filterCards(amostra, { status: ['approved', 'wait'] }).length, 2, 'modo rascunho inclui wait');
igual(filterCards(amostra, { topics: ['educacao'], status: ['approved', 'wait'] }).length, 1, 'filtro por tema');
igual(filterCards(amostra, { search: 'educacao', status: ['approved', 'wait'] }).length, 1, 'busca por tema');
igual(filterCards(amostra, { search: 'zzz', status: ['approved', 'wait'] }).length, 0, 'busca sem resultado');
igual(normalize('Educação'), 'educacao', 'normalize remove acento e caixa');

igual(arrange(amostra, { order: 'numero' })[0].id, 'C01', 'ordenação por número');
igual(arrange(amostra, { order: 'id' })[1].id, 'C02', 'ordenação por id');
igual(arrange(amostra, { order: 'tema' })[0].topic, 'educacao', 'ordenação por tema');
igual(arrange(amostra, { order: 'embaralhado', seed: 's' }).length, 2, 'ordenação embaralhada');

igual(chunk([1, 2, 3, 4, 5], 2).length, 3, 'chunk divide em grupos');
igual(padToMultiple([1, 2, 3], 4).length, 4, 'padToMultiple completa com nulos');
igual(padToMultiple([1, 2, 3], 4)[3], null, 'preenchimento é null');

// Espelhamento duplex: 4 colunas × 2 linhas.
const oito = [1, 2, 3, 4, 5, 6, 7, 8];
igual(JSON.stringify(mirrorForDuplex(oito, 4, 2, 'longa')), JSON.stringify([5, 6, 7, 8, 1, 2, 3, 4]), 'borda longa espelha as linhas');
igual(JSON.stringify(mirrorForDuplex(oito, 4, 2, 'curta')), JSON.stringify([4, 3, 2, 1, 8, 7, 6, 5]), 'borda curta espelha as colunas');
igual(mirrorForDuplex(oito, 4, 2, 'longa').length, 8, 'espelhamento preserva o tamanho');
// Folha incompleta: os vazios precisam continuar nos mesmos slots físicos.
const tres = [1, 2, 3, null, null, null, null, null];
igual(JSON.stringify(mirrorForDuplex(tres, 4, 2, 'longa')), JSON.stringify([null, null, null, null, 1, 2, 3, null]), 'folha incompleta mantém os vazios no lugar');

/* ------------------------------------------------------------------ *
 * 2b. Tópicos do usuário (renomear, criar, atribuir)
 * ------------------------------------------------------------------ */

igual(slugificar('Arte e Educação'), 'arte-e-educacao', 'slugificar tira acento e espaço');
igual(slugificar('  ///  '), 'topico', 'slugificar tem valor de reserva');
igual(slugUnico('arte', new Set(['arte'])), 'arte-2', 'slugUnico desvia de colisão');
igual(slugUnico('arte', new Set(['arte', 'arte-2'])), 'arte-3', 'slugUnico pula colisões seguidas');

const vazio = overlayVazio();
const porSlug = new Map(topics.temas.map((t) => [t.slug, t]));
const cartaBase = { id: 'C01', topic: 'economia', quote: 'x'.repeat(12), autor: 'A', status: 'wait' };

let efetivo = resolverTopico(cartaBase, vazio, porSlug);
igual(efetivo.slug, 'economia', 'sem overlay o tópico é o da base');
igual(efetivo.label, 'Economia', 'rótulo da base');
ok(!efetivo.proprio, 'tema da base não é tópico próprio');

const renomeado = normalizarOverlay({ renomeados: { economia: { label: 'Dinheiro do povo', slug: 'dinheiro' } } });
efetivo = resolverTopico(cartaBase, renomeado, porSlug);
igual(efetivo.slug, 'dinheiro', 'renomear troca a etiqueta # da carta');
igual(efetivo.label, 'Dinheiro do povo', 'renomear troca o nome exibido');
igual(efetivo.chave, 'economia', 'a chave continua sendo o slug da base');

const comProprio = normalizarOverlay({
  proprios: [{ id: 't1', label: 'Arte e educação', simbolo: '◆', cor: 'preto' }],
  atribuicoes: { C01: 't1' },
});
efetivo = resolverTopico(cartaBase, comProprio, porSlug);
ok(efetivo.proprio, 'carta atribuída a um tópico próprio');
igual(efetivo.slug, 'arte-e-educacao', 'etiqueta derivada do nome do tópico próprio');
igual(efetivo.label, 'Arte e educação', 'nome do tópico próprio');

const aplicadas = aplicarOverlay([cartaBase], comProprio, porSlug);
igual(aplicadas[0].topic, 'arte-e-educacao', 'aplicarOverlay troca o topic da carta');
igual(aplicadas[0]._topico.label, 'Arte e educação', 'aplicarOverlay guarda o tópico resolvido');
igual(cartaBase.topic, 'economia', 'a carta original não é alterada');

const listaTopicos = listarTopicos([cartaBase, { id: 'C02', topic: 'economia' }], comProprio, topics.temas);
igual(listaTopicos.length, topics.temas.length + 1, 'lista traz a base + 1 tópico próprio');
igual(listaTopicos.find((t) => t.slug === 'arte-e-educacao').total, 1, 'contagem do tópico próprio');
igual(listaTopicos.find((t) => t.slug === 'arte-e-educacao').proprio, true, 'tópico próprio é marcado');
igual(listaTopicos.find((t) => t.chave === 'economia').total, 1, 'contagem do tema base após a atribuição');

// Tema fora da taxonomia não pode sumir da lista.
const orfaos = listarTopicos([{ id: 'C99', topic: 'tema-solto' }], vazio, topics.temas);
ok(orfaos.some((t) => t.slug === 'tema-solto'), 'tema órfão aparece na lista');

const sujo = normalizarOverlay({
  proprios: [{ label: '   ' }, { id: 't1', label: 'Ok' }, { id: 't1', label: 'Outro' }],
  atribuicoes: { C01: 't1', C02: '' },
});
igual(sujo.proprios.length, 2, 'tópico sem nome é descartado');
igual(new Set(sujo.proprios.map((t) => t.id)).size, 2, 'ids de tópico próprio ficam únicos');
ok(!('C02' in sujo.atribuicoes), 'atribuição vazia é descartada');
igual(normalizarOverlay(null).proprios.length, 0, 'overlay inválido vira overlay vazio');

ok(slugsEmUso(comProprio, topics.temas).has('arte-e-educacao'), 'slug próprio entra em slugsEmUso');
ok(slugsEmUso(renomeado, topics.temas).has('dinheiro'), 'slug renomeado entra em slugsEmUso');
igual(proximoId(comProprio), 't2', 'próximo id livre de tópico próprio');

// Armazenamento local (com storage falso, sem navegador).
const memoria = (() => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
})();
ok(disponivel(memoria), 'storage aceita escrita');
ok(gravarOverlay(comProprio, memoria), 'grava o overlay');
igual(lerOverlay(memoria).proprios.length, 1, 'lê o overlay de volta');
igual(lerOverlay(memoria).atribuicoes.C01, 't1', 'atribuição preservada na ida e volta');
igual(importarOverlay(exportarOverlay(comProprio)).proprios[0].label, 'Arte e educação', 'exportar/importar preserva os dados');
memoria.setItem(CHAVE_OVERLAY, '{isso não é json');
igual(lerOverlay(memoria).proprios.length, 0, 'JSON corrompido não derruba o app');
ok(limparOverlay(memoria), 'limpa o overlay');
igual(lerOverlay(memoria).proprios.length, 0, 'depois de limpar, volta ao vazio');

/* ------------------------------------------------------------------ *
 * 2c. O baralho do jogo (sem métrica: só o monte e a ordem)
 * ------------------------------------------------------------------ */

const cartasJogo = [
  { id: 'J1', numeroNaCarta: 1, topic: 'saude', status: 'wait', quote: 'q1', autor: 'A' },
  { id: 'J2', numeroNaCarta: 2, topic: 'educacao', status: 'approved', quote: 'q2', autor: 'B' },
  { id: 'J3', numeroNaCarta: 3, topic: 'saude', status: 'approved', quote: 'q3', autor: 'C' },
  { id: 'J4', numeroNaCarta: 4, topic: 'economia', status: 'reject', quote: 'q4', autor: 'D' },
];

igual(montarBaralho(cartasJogo, { incluirRascunho: false }).length, 2, 'só aprovadas no baralho sem rascunho');
igual(montarBaralho(cartasJogo, { incluirRascunho: true }).length, 3, 'rascunho inclui wait, mas nunca reject');
igual(montarBaralho(cartasJogo, { temas: ['saude'], incluirRascunho: true }).length, 2, 'filtro por tema');
igual(montarBaralho(cartasJogo, { ordem: 'numero', incluirRascunho: true })[0].id, 'J1', 'ordem por número');
igual(
  JSON.stringify(montarBaralho(cartasJogo, { seed: 'x' }).map((c) => c.id)),
  JSON.stringify(montarBaralho(cartasJogo, { seed: 'x' }).map((c) => c.id)),
  'embaralhamento reproduzível com a mesma seed'
);

const baralho = montarBaralho(cartasJogo, { ordem: 'numero', incluirRascunho: true });
let sessao = novaSessao(baralho, { seed: 'teste' });
igual(sessao.total, 3, 'sessão sabe o total');
igual(sessao.indice, 0, 'sessão começa na primeira carta');
ok(!acabou(sessao), 'sessão não começa concluída');
igual(cartaAtual(sessao, baralho).id, 'J1', 'carta da vez é a primeira');
igual(restantes(sessao), 2, 'restam duas cartas no monte depois da primeira');

sessao = avancar(sessao);
igual(sessao.indice, 1, 'avançar muda de carta');
igual(cartaAtual(sessao, baralho).id, 'J2', 'segunda carta na vez');
igual(restantes(sessao), 1, 'o monte encolhe ao comprar');
sessao = retroceder(sessao);
igual(sessao.indice, 0, 'retroceder volta uma carta');
igual(restantes(sessao), 2, 'e o monte volta a crescer');

sessao = avancar(avancar(sessao));
igual(sessao.indice, 2, 'chega à última carta');
igual(restantes(sessao), 0, 'sem cartas no monte');
ok(!acabou(sessao), 'ainda há uma carta na mesa');
sessao = avancar(sessao);
ok(sessao.fim, 'avançar na última carta sinaliza fim');
igual(sessao.indice, 2, 'e não sai da última carta');

const reembaralhada = reembaralhar(sessao, baralho, 'depois');
igual(reembaralhada.total, 3, 'reembaralhar mantém as cartas da sessão');
igual(reembaralhada.indice, 0, 'e volta ao começo');
igual(JSON.stringify([...reembaralhada.ids].sort()), JSON.stringify(['J1', 'J2', 'J3']), 'sem perder nem inventar cartas');

igual(novaSessao([], {}).total, 0, 'baralho vazio não quebra a sessão');
igual(cartaAtual(novaSessao([], {}), []), null, 'sem carta na vez quando o baralho está vazio');

/* ------------------------------------------------------------------ *
 * 3. QR Code
 * ------------------------------------------------------------------ */

igual(pickVersion(1, 1), 1, 'v1 comporta 1 byte em M');
igual(numDataCodewords(1, 1), 16, 'v1-M tem 16 codewords de dados');
igual(numDataCodewords(1, 0), 19, 'v1-L tem 19 codewords de dados');
igual(numDataCodewords(40, 0), 2956, 'v40-L tem 2956 codewords de dados');
igual(rsBlockStructure(5, 2).numBlocks, 4, 'v5-Q tem 4 blocos');
igual(rsBlockStructure(5, 2).eccPerBlock, 18, 'v5-Q usa 18 codewords de ECC por bloco');
igual(JSON.stringify(alignmentPositions(7)), JSON.stringify([6, 22, 38]), 'alinhamento da v7');
igual(JSON.stringify(alignmentPositions(32)), JSON.stringify([6, 34, 60, 86, 112, 138]), 'alinhamento da v32 (caso especial)');
igual(JSON.stringify(alignmentPositions(1)), JSON.stringify([]), 'v1 não tem alinhamento');

const curto = encodeQR('a');
igual(curto.size, 21, 'v1 gera matriz 21×21');
igual(curto.version, 1, 'v1 escolhida para 1 byte em M');
ok(curto.modules.every((linha) => linha.length === 21), 'todas as linhas têm 21 módulos');
ok(curto.modules.every((linha) => linha.every((m) => m === 0 || m === 1)), 'módulos são 0/1');

// Localizadores e temporização (ISO/IEC 18004, 6.3).
const localizadorOk = (m, cx, cy) => {
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const esperado = Math.max(Math.abs(dx), Math.abs(dy)) !== 2 ? 1 : 0;
      if (m[cy + dy][cx + dx] !== esperado) return false;
    }
  }
  return true;
};
const m = curto.modules;
ok(localizadorOk(m, 3, 3), 'localizador superior esquerdo');
ok(localizadorOk(m, 17, 3), 'localizador superior direito');
ok(localizadorOk(m, 3, 17), 'localizador inferior esquerdo');
igual(m[curto.size - 8][8], 1, 'módulo sempre escuro na posição (x=8, y=size-8)');
let timingOk = true;
for (let i = 8; i <= 12; i++) if (m[6][i] !== (i % 2 === 0 ? 1 : 0)) timingOk = false;
ok(timingOk, 'padrão de temporização da linha 6');

// Regressão: hashes congelados de uma matriz verificada contra a referência.
const HASHES = [
  ['a', 'M', 1, 5, 'e8ab680854e4019c'],
  ['https://example.org/fonte-oficial', 'M', 3, 2, 'cdcda62d010f8269'],
  ['https://web.archive.org/web/2026/https://lula.com.br/propostas/', 'M', 5, 2, 'eb4fdbe14772ac7b'],
  ['citação: "O Brasil tem um único dono: o povo brasileiro." #economia', 'Q', 6, 2, '16633b7e5ed74a66'],
];
for (const [texto, nivel, versao, mascara, hash] of HASHES) {
  const q = encodeQR(texto, { ecc: nivel });
  const resumo = createHash('sha256').update(q.modules.map((r) => r.join('')).join('\n')).digest('hex').slice(0, 16);
  igual(q.version, versao, `versão de "${texto.slice(0, 24)}…"`);
  igual(q.mask, mascara, `máscara de "${texto.slice(0, 24)}…"`);
  igual(resumo, hash, `matriz estável de "${texto.slice(0, 24)}…"`);
}

const svg = qrSvg('https://example.org/fonte-oficial', { ecc: 'M' });
ok(svg.startsWith('<svg '), 'SVG começa com <svg');
ok(svg.endsWith('</svg>'), 'SVG termina com </svg>');
ok(svg.includes('shape-rendering="crispEdges"'), 'SVG usa bordas nítidas');
ok(svg.includes('role="img"'), 'SVG tem role de imagem');
ok(svg.includes('aria-label="'), 'SVG tem rótulo acessível');
ok(svg.length < 20000, 'SVG é leve', svg.length + ' bytes');
ok(svgSvgSemBarra(svg), 'SVG não tem caminho vazio');
function svgSvgSemBarra(s) {
  return /<path d="M/.test(s);
}

/* ------------------------------------------------------------------ *
 * 4. Servidor
 * ------------------------------------------------------------------ */

/**
 * `pedir(caminho)`, `pedir(caminho, porta)` ou `pedir(caminho, {metodo, corpo})`.
 * O corpo é serializado em JSON — é só o que a API aceita.
 */
function pedir(caminho, portaOuOpcoes = PORTA, opcoesTalvez = {}) {
  const porta = typeof portaOuOpcoes === 'number' ? portaOuOpcoes : PORTA;
  const opcoes = typeof portaOuOpcoes === 'number' ? opcoesTalvez : portaOuOpcoes;
  const { metodo = 'GET', corpo = null, cabecalhos = {} } = opcoes || {};

  return new Promise((resolver, rejeitar) => {
    const dados = corpo == null ? null : Buffer.from(JSON.stringify(corpo), 'utf8');
    const headers = { ...cabecalhos };
    if (dados) headers['content-length'] = dados.length;

    const req = request({ host: '127.0.0.1', port: porta, path: caminho, method: metodo, headers }, (res) => {
      const partes = [];
      res.on('data', (d) => partes.push(d));
      res.on('end', () =>
        resolver({ status: res.statusCode, tipo: res.headers['content-type'] || '', corpo: Buffer.concat(partes).toString('utf8') })
      );
    });
    req.on('error', rejeitar);
    if (dados) req.write(dados);
    req.end();
  });
}

async function esperarServidor(tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await pedir('/api/health');
      if (r.status === 200) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

// Limpa ANTES também: uma execução interrompida não pode deixar revisão
// pendurada e envenenar a próxima.
rmSync(join(APP, 'data', 'curadoria.teste.json'), { force: true });
rmSync(join(APP, 'data', 'curadoria.teste.json.tmp'), { force: true });

const servidor = spawn(process.execPath, [join(APP, 'web', 'server.mjs')], {
  // BARALHO_DATA vazio de propósito: o teste precisa do seed, não de um fixture.
  // BARALHO_DATA vazio de propósito: o teste precisa do seed, não de um fixture.
  // A curadoria vai para um arquivo descartável: o teste ESCREVE nele, e não pode
  // sujar a revisão de verdade.
  env: { ...process.env, BARALHO_PORT: String(PORTA), BARALHO_HOST: '127.0.0.1', BARALHO_DATA: '', BARALHO_CURADORIA: 'curadoria.teste.json' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logServidor = '';
servidor.stdout.on('data', (d) => (logServidor += d));
servidor.stderr.on('data', (d) => (logServidor += d));

try {
  ok(await esperarServidor(), 'servidor responde em /api/health', logServidor.slice(0, 200));

  const saude = JSON.parse((await pedir('/api/health')).corpo);
  igual(saude.total, 50, 'health vê 50 cartas');
  igual(saude.porStatus.wait, 49, 'health conta 49 em rascunho');
  igual(saude.porStatus.reject, 1, 'health conta 1 rejeitada');

  const publico = JSON.parse((await pedir('/api/cards')).corpo);
  igual(publico.cards.length, 0, 'sem draft=1 nenhuma carta sai (regra dura)');
  igual(publico.omitidas, 50, 'as 50 ficam de fora');

  const rascunho = JSON.parse((await pedir('/api/cards?draft=1')).corpo);
  igual(rascunho.cards.length, 50, 'com draft=1 saem as 50');
  ok(rascunho.cards.some((c) => c.status === 'wait'), 'draft traz cartas wait');

  /* ---------------- triagem: a regra dura, do lado da escrita ---------------- */

  const curadoriaVazia = JSON.parse((await pedir('/api/curadoria')).corpo);
  igual(curadoriaVazia.total, 0, 'a curadoria começa vazia');
  ok(curadoriaVazia.revisoes && typeof curadoriaVazia.revisoes === 'object', 'curadoria devolve revisões');

  const postar = (corpo) =>
    pedir('/api/curadoria', {
      metodo: 'POST',
      corpo,
      cabecalhos: { 'content-type': 'application/json' },
    });

  // sem revisor identificado não se decide nada
  igual((await postar({ id: 'C33', status: 'approved' })).status, 400,
    'revisão sem revisor é recusada');
  igual((await postar({ id: 'C33', status: 'aprovada', revisor: 'Revisora de Teste' })).status, 400,
    'status inválido é recusado');
  igual((await postar({ id: 'NAO_EXISTE', status: 'wait', revisor: 'Revisora de Teste' })).status, 404,
    'carta inexistente é recusada');
  igual((await postar({ id: 'C33', status: 'reject', revisor: 'Revisora de Teste' })).status, 400,
    'rejeitar sem motivo é recusado');

  // a regra dura: sem fonte, não aprova
  const semFonte = cardsSeed.cards.find((c) => !c.link && c.status !== 'reject');
  ok(Boolean(semFonte), 'há carta sem fonte para exercitar a regra');
  const recusada = await postar({ id: semFonte.id, status: 'approved', revisor: 'Revisora de Teste' });
  igual(recusada.status, 409, 'aprovar carta sem fonte é recusado');
  ok(/fonte/i.test(JSON.parse(recusada.corpo).erro || ''), 'o erro explica que falta a fonte');

  // aprovando de verdade, a carta entra no bundle público
  const comFonte = cardsSeed.cards.find((c) => c.link);
  const aprovada = await postar({ id: comFonte.id, status: 'approved', revisor: 'Revisora de Teste' });
  igual(aprovada.status, 200, 'aprovar carta com fonte funciona');
  const corpoAprovado = JSON.parse(aprovada.corpo);
  igual(corpoAprovado.revisao.status, 'approved', 'a revisão registra o status');
  ok(corpoAprovado.revisao.revisor === 'Revisora de Teste', 'a revisão registra quem revisou');
  ok(Boolean(corpoAprovado.revisao.em), 'a revisão registra quando');

  const publicoAgora = JSON.parse((await pedir('/api/cards')).corpo);
  igual(publicoAgora.cards.length, 1, 'a carta aprovada passa a sair no bundle público');
  igual(publicoAgora.cards[0].id, comFonte.id, 'é exatamente a carta aprovada');
  igual(publicoAgora.cards[0].revisao.revisor, 'Revisora de Teste', 'o público vê a trilha da revisão');
  igual(publicoAgora.omitidas, 49, 'as outras 49 continuam de fora');

  // rejeitar guarda o motivo e tira a carta do baralho
  const rejeitada = await postar({
    id: comFonte.id, status: 'reject', revisor: 'Revisora de Teste', motivo: 'fonte não confere',
  });
  igual(rejeitada.status, 200, 'rejeitar com motivo funciona');
  const publicoDepois = JSON.parse((await pedir('/api/cards')).corpo);
  igual(publicoDepois.cards.length, 0, 'carta rejeitada volta a ficar fora do público');
  const rascunhoDepois = JSON.parse((await pedir('/api/cards?draft=1')).corpo);
  const achada = rascunhoDepois.cards.find((c) => c.id === comFonte.id);
  igual(achada.status, 'reject', 'o status revisado vale no rascunho');
  igual(achada.motivoRejeicao, 'fonte não confere', 'o motivo fica gravado na carta');

  // o seed em disco não foi reescrito
  const seedDepois = JSON.parse(await readFile(join(APP, 'data', 'cards.seed.json'), 'utf8'));
  igual(seedDepois.cards.find((c) => c.id === comFonte.id).status, comFonte.status,
    'a curadoria não reescreve o arquivo de pesquisa');

  // e o arquivo de curadoria é separado
  const arquivoCuradoria = JSON.parse(await readFile(join(APP, 'data', 'curadoria.teste.json'), 'utf8'));
  ok(Boolean(arquivoCuradoria.revisoes[comFonte.id]), 'a revisão vive em arquivo próprio');

  // métodos não previstos continuam barrados
  igual((await pedir('/api/cards', { metodo: 'POST', corpo: {} })).status, 405,
    'POST fora de /api/curadoria é barrado');

  const temas = JSON.parse((await pedir('/api/topics')).corpo);
  ok(Array.isArray(temas.temas) && temas.temas.length >= 16, 'GET /api/topics devolve a taxonomia');

  const pagina = await pedir('/print.html');
  igual(pagina.status, 200, 'GET /print.html');
  ok(pagina.corpo.includes('estúdio de impressão'), 'print.html é a página certa');
  ok(pagina.corpo.includes('teste-folhas'), 'print.html tem o contêiner do teste de alinhamento');
  ok(pagina.corpo.includes('topicos.html'), 'o estúdio aponta para o editor de tópicos');

  const editor = await pedir('/topicos.html');
  igual(editor.status, 200, 'GET /topicos.html');
  ok(editor.corpo.includes('Criar tópico próprio'), 'a página é o editor de tópicos');

  const editorJs = await pedir('/topicos.js');
  ok(editorJs.status === 200 && editorJs.corpo.includes('listarTopicos'), 'GET /topicos.js');

  const editorCss = await pedir('/topicos.css');
  ok(editorCss.status === 200 && editorCss.corpo.includes('.topico-linha'), 'GET /topicos.css');

  const modTopics = await pedir('/lib/topics.mjs');
  igual(modTopics.status, 200, 'GET /lib/topics.mjs');
  const modStore = await pedir('/lib/store.mjs');
  igual(modStore.status, 200, 'GET /lib/store.mjs');

  const favicon = await pedir('/favicon.svg');
  ok(favicon.status === 200 && favicon.tipo.includes('svg'), 'GET /favicon.svg');

  // Créditos e app instalável.
  const apiCreditos = await pedir('/api/creditos');
  igual(apiCreditos.status, 200, 'GET /api/creditos');
  const creditosApi = JSON.parse(apiCreditos.corpo);
  igual(creditosApi.titulo, creditos.titulo, '/api/creditos devolve o mesmo arquivo');

  const paginaCreditos = await pedir('/creditos.html');
  igual(paginaCreditos.status, 200, 'GET /creditos.html');

  const paginaFontes = await pedir('/fontes.html');
  igual(paginaFontes.status, 200, 'GET /fontes.html');
  ok(paginaFontes.corpo.includes('Índice de fontes'), 'a página de fontes traz o índice');

  const planilha = await pedir('/api/cards.csv');
  igual(planilha.status, 200, 'GET /api/cards.csv');
  ok(planilha.tipo.includes('text/csv'), 'a planilha vem como CSV', planilha.tipo);
  const linhasPlanilha = parseCsv(planilha.corpo);
  igual(linhasPlanilha.length - 1, cardsSeed.cards.length, 'a planilha servida tem uma linha por carta');
  igual(linhasPlanilha[0].join(','), 'id,numeroNaCarta,quote,autor,autorId,cargo,partido,data,dataPrecisao,veiculo,link,arquivo,topic,status,contributor,relevance,observacao,motivoRejeicao',
    'o cabeçalho da planilha é o esperado');

  const paginaTriagem = await pedir('/triagem.html');
  igual(paginaTriagem.status, 200, 'GET /triagem.html');
  ok(paginaTriagem.corpo.includes('Painel de triagem'), 'a página de triagem traz o painel');
  igual((await pedir('/triagem.js')).status, 200, 'GET /triagem.js');
  const jsFontes = await pedir('/fontes.js');
  igual(jsFontes.status, 200, 'GET /fontes.js');
  const padrao = await pedir('/padrao-dorso.webp');
  igual(padrao.status, 200, 'GET /padrao-dorso.webp (textura do dorso)');
  ok(paginaCreditos.corpo.includes('créditos'), 'a página de créditos é a certa');

  const jsCreditos = await pedir('/creditos.js');
  ok(jsCreditos.status === 200 && jsCreditos.corpo.includes('/api/creditos'), 'GET /creditos.js');
  const cssCreditos = await pedir('/creditos.css');
  ok(cssCreditos.status === 200 && cssCreditos.corpo.includes('.credito-bloco'), 'GET /creditos.css');

  const manifest = await pedir('/manifest.webmanifest');
  igual(manifest.status, 200, 'GET /manifest.webmanifest');
  ok(manifest.tipo.includes('manifest+json'), 'manifesto servido com o MIME correto', manifest.tipo);
  ok(JSON.parse(manifest.corpo).icons.length >= 3, 'manifesto servido é válido');

  for (const icone of ['/icone-192.png', '/icone-512.png', '/icone-maskable.png']) {
    const resposta = await pedir(icone);
    ok(resposta.status === 200 && resposta.tipo === 'image/png', `GET ${icone}`);
  }

  // O jogo.
  const jogoPagina = await pedir('/jogo.html');
  igual(jogoPagina.status, 200, 'GET /jogo.html');
  ok(jogoPagina.corpo.includes('monte'), 'a página é o jogo');
  ok(jogoPagina.corpo.includes('carta__face--verso'), 'o jogo tem o verso da carta');
  ok(!/instru|explica|ajuda/i.test(jogoPagina.corpo), 'a página do jogo não tem texto explicativo');

  const jogoJs = await pedir('/jogo.js');
  ok(jogoJs.status === 200 && jogoJs.corpo.includes('montarBaralho'), 'GET /jogo.js');
  ok(!jogoJs.corpo.includes('localStorage'), 'o jogo não guarda placar nem métrica');
  const jogoCss = await pedir('/jogo.css');
  ok(jogoCss.status === 200 && jogoCss.corpo.includes('.carta__interno'), 'GET /jogo.css');
  const modJogo = await pedir('/lib/jogo.mjs');
  igual(modJogo.status, 200, 'GET /lib/jogo.mjs');

  // As outras páginas precisam levar ao jogo.
  for (const pagina of ['/print.html', '/topicos.html', '/creditos.html', '/fontes.html']) {
    const resposta = await pedir(pagina);
    ok(resposta.corpo.includes('jogo.html'), `${pagina} aponta para o jogo`);
  }

  // A página inicial precisa apontar para todas as seções do app.
  const inicial = await pedir('/');
  for (const destino of ['jogo.html', 'print.html', 'topicos.html', 'creditos.html']) {
    ok(inicial.corpo.includes(destino), `a página inicial aponta para ${destino}`);
  }

  const css = await pedir('/print.css');
  ok(css.status === 200 && css.corpo.includes('@page'), 'GET /print.css');

  const js = await pedir('/print.js');
  ok(js.status === 200 && js.corpo.includes('mirrorForDuplex'), 'GET /print.js');

  const modulo = await pedir('/lib/qr.mjs');
  igual(modulo.status, 200, 'GET /lib/qr.mjs (módulo compartilhado)');
  ok(modulo.tipo.startsWith('text/javascript'), 'módulo servido como JavaScript', modulo.tipo);

  const raiz = await pedir('/');
  igual(raiz.status, 200, 'GET / serve a página inicial');

  // Travessia de caminho: pedido cru, sem normalização do cliente.
  const travessia = await pedir('/lib/..%2f..%2fdata%2fcards.seed.json');
  ok(travessia.status === 403 || travessia.status === 404, 'travessia de caminho bloqueada', String(travessia.status));
  ok(!travessia.corpo.includes('"cards"'), 'travessia não vaza o conjunto de dados');
} finally {
  servidor.kill('SIGTERM');
}

/* ------------------------------------------------------------------ *
 * CSV: a planilha é a fonte das cartas
 * ------------------------------------------------------------------ */

{
  const NL = String.fromCharCode(10);

  // ida e volta pura: o que o parser lê, o escritor devolve igual
  const colunas = ['id', 'quote', 'observacao'];
  const registros = [
    { id: 'C01', quote: 'disse "olá", e foi embora', observacao: 'linha 1' + NL + 'linha 2' },
    { id: 'C02', quote: 'sem vírgula', observacao: '' },
  ];
  const texto = escreverCsv(colunas, registros);
  const voltou = paraObjetos(parseCsv(texto));
  igual(voltou.registros.length, 2, 'CSV: ida e volta mantém os registros');
  igual(voltou.registros[0].quote, 'disse "olá", e foi embora', 'CSV: aspas e vírgula sobrevivem');
  igual(voltou.registros[0].observacao, 'linha 1' + NL + 'linha 2',
    'CSV: quebra de linha dentro do campo sobrevive');
  igual(voltou.registros[1].observacao, '', 'CSV: campo vazio continua vazio');
  igual(voltou.colunas.join(','), 'id,quote,observacao', 'CSV: cabeçalho preservado');

  // casos que aparecem em planilha de verdade
  igual(campoCsv('simples'), 'simples', 'CSV: campo simples não é citado');
  igual(campoCsv('a,b'), '"a,b"', 'CSV: vírgula força aspas');
  igual(campoCsv('diz "oi"'), '"diz ""oi"""', 'CSV: aspas dobram');
  igual(campoCsv(null), '', 'CSV: nulo vira vazio');
  igual(paraObjetos(parseCsv('a,b' + NL + '1,2' + NL)).registros.length, 1,
    'CSV: quebra no fim não cria registro fantasma');
  const comBom = String.fromCharCode(0xfeff) + 'a,b' + NL + '1,2' + NL;
  igual(paraObjetos(parseCsv(comBom)).colunas[0], 'a', 'CSV: BOM é ignorado (planilhas gravam BOM)');
  let erroColunas = false;
  try { paraObjetos([['a'], ['1', '2']]); } catch { erroColunas = true; }
  ok(erroColunas, 'CSV: campo sobrando é erro, não silêncio');

  const { execFileSync } = await import('node:child_process');
  let emSincronia = true;
  let saida = '';
  try {
    saida = execFileSync(process.execPath, [join(APP, 'tools', 'cards-csv.mjs'), 'conferir'], { encoding: 'utf8' });
  } catch (err) {
    emSincronia = false;
    saida = String(err.stdout || '') + String(err.stderr || '');
  }
  ok(emSincronia, 'cards.seed.json bate com cards.csv', saida.trim().slice(0, 120));

  // e o CSV tem exatamente as cartas do JSON, campo por campo
  const { lerCartas } = await import('../tools/cards-csv.mjs');
  const doCsv = await lerCartas();
  igual(doCsv.length, cardsSeed.cards.length, 'CSV: mesma quantidade de cartas que o JSON');
  const jsonPorId = new Map(cardsSeed.cards.map((c) => [c.id, c]));
  let divergentes = 0;
  for (const carta of doCsv) {
    const doJson = jsonPorId.get(carta.id);
    if (!doJson) { divergentes++; continue; }
    for (const campo of Object.keys(carta)) {
      if (JSON.stringify(carta[campo]) !== JSON.stringify(doJson[campo] ?? null)) divergentes++;
    }
  }
  igual(divergentes, 0, 'CSV: nenhum campo divergente do JSON', String(divergentes));
}

/* ------------------------------------------------------------------ *
 * Limpeza
 * ------------------------------------------------------------------ */

// O teste escreve curadoria: o arquivo descartável não pode sobrar, senão a
// próxima execução (ou outro teste) leria revisões que não existem.
try {
  servidor.kill('SIGTERM');
} catch {
  /* já caiu */
}
rmSync(join(APP, 'data', 'curadoria.teste.json'), { force: true });
rmSync(join(APP, 'data', 'curadoria.teste.json.tmp'), { force: true });

/* ------------------------------------------------------------------ *
 * Resumo
 * ------------------------------------------------------------------ */

console.log(`\nbaralho-app · testes`);
console.log(`  ${passou} verificações passaram`);
if (falhas.length) {
  console.log(`  ${falhas.length} FALHA(S):`);
  for (const f of falhas.slice(0, 30)) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log('  tudo certo ✓');
