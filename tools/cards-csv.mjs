#!/usr/bin/env node
/**
 * Conversor entre a planilha e o conjunto de cartas.
 *
 *   node tools/cards-csv.mjs exportar    # data/cards.seed.json -> data/cards.csv
 *   node tools/cards-csv.mjs importar    # data/cards.csv      -> data/cards.seed.json
 *   node tools/cards-csv.mjs conferir    # falha se os dois estiverem fora de sincronia
 *
 * O CSV é a FONTE: é onde a pesquisa é editada, numa planilha, linha por carta.
 * O JSON (`cards.seed.json`) é o artefato que o app lê — gerado, commitado para
 * o app rodar sem passo de build, e conferido pelo `conferir` e pelos testes.
 *
 * Os metadados do conjunto (versão do esquema, aviso, campos obrigatórios) não
 * são cartas: ficam em `data/cards.meta.json`.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, paraObjetos, escreverCsv } from '../lib/csv.mjs';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(APP, 'data');
const CSV = join(DATA, 'cards.csv');
const JSON_SEED = join(DATA, 'cards.seed.json');
const META = join(DATA, 'cards.meta.json');

/** A ordem das colunas é a da planilha: legível para quem edita. */
export const COLUNAS = [
  'id',
  'numeroNaCarta',
  'quote',
  'autor',
  'autorId',
  'cargo',
  'partido',
  'data',
  'dataPrecisao',
  'veiculo',
  'link',
  'arquivo',
  'topic',
  'status',
  'contributor',
  'relevance',
  'observacao',
  'motivoRejeicao',
];

const NUMEROS = new Set(['numeroNaCarta', 'relevance']);
const STATUS = new Set(['approved', 'wait', 'reject']);

const texto = (v) => {
  if (v === null || v === undefined) return '';
  return String(v);
};

/** Vazio vira null; número vira número; o resto é texto aparado. */
function daPlanilha(coluna, bruto) {
  const valor = (bruto ?? '').trim();
  if (NUMEROS.has(coluna)) {
    if (valor === '') return null;
    const n = Number(valor);
    if (!Number.isFinite(n)) throw new Error(`"${coluna}" precisa ser número, veio "${valor}"`);
    return n;
  }
  return valor === '' ? null : valor;
}

function paraPlanilha(carta, coluna) {
  const valor = carta[coluna];
  return valor === null || valor === undefined ? '' : texto(valor);
}

/** Lê o CSV e devolve as cartas, validando o que quebraria o app em silêncio. */
export async function lerCartas() {
  const bruto = await readFile(CSV, 'utf8');
  const { colunas, registros } = paraObjetos(parseCsv(bruto));

  const faltando = COLUNAS.filter((c) => !colunas.includes(c));
  if (faltando.length) throw new Error('CSV sem as colunas: ' + faltando.join(', '));
  const sobrando = colunas.filter((c) => !COLUNAS.includes(c));
  if (sobrando.length) throw new Error('CSV com colunas desconhecidas: ' + sobrando.join(', '));

  const cartas = registros.map((registro, i) => {
    const linha = i + 2; // 1 é o cabeçalho
    const carta = {};
    for (const coluna of COLUNAS) carta[coluna] = daPlanilha(coluna, registro[coluna]);

    for (const obrigatorio of ['id', 'quote', 'topic', 'status', 'contributor']) {
      if (!carta[obrigatorio]) throw new Error(`linha ${linha}: "${obrigatorio}" está vazio`);
    }
    if (!STATUS.has(carta.status)) {
      throw new Error(`linha ${linha}: status "${carta.status}" não é approved, wait nem reject`);
    }
    if (!Number.isInteger(carta.numeroNaCarta)) {
      throw new Error(`linha ${linha}: "numeroNaCarta" precisa ser inteiro`);
    }
    if (carta.status === 'approved' && !carta.link) {
      throw new Error(`linha ${linha} (${carta.id}): carta aprovada sem fonte anexada`);
    }
    if (carta.status === 'reject' && !carta.motivoRejeicao) {
      throw new Error(`linha ${linha} (${carta.id}): carta rejeitada sem motivo`);
    }
    return carta;
  });

  const ids = new Set();
  for (const c of cartas) {
    if (ids.has(c.id)) throw new Error('id repetido no CSV: ' + c.id);
    ids.add(c.id);
  }
  const numeros = new Set();
  for (const c of cartas) {
    if (numeros.has(c.numeroNaCarta)) throw new Error('número de carta repetido: ' + c.numeroNaCarta);
    numeros.add(c.numeroNaCarta);
  }

  return cartas;
}

async function lerMeta() {
  return JSON.parse(await readFile(META, 'utf8'));
}

function montarJson(meta, cartas) {
  return {
    schemaVersion: meta.schemaVersion,
    nome: meta.nome,
    gerado: 'Este arquivo é GERADO a partir de data/cards.csv. Não edite à mão: edite a planilha e rode `node tools/cards-csv.mjs importar`.',
    aviso: meta.aviso,
    camposObrigatorios: meta.camposObrigatorios,
    cards: cartas,
  };
}

/* ------------------------------------------------------------------ */

const comando = process.argv[2] || 'conferir';

if (comando === 'exportar') {
  const seed = JSON.parse(await readFile(JSON_SEED, 'utf8'));
  const registros = seed.cards.map((c) => Object.fromEntries(COLUNAS.map((col) => [col, paraPlanilha(c, col)])));
  await writeFile(CSV, escreverCsv(COLUNAS, registros, { quebra: '\n' }), 'utf8');
  console.log(`data/cards.csv escrito com ${registros.length} cartas.`);
} else if (comando === 'importar') {
  const cartas = await lerCartas();
  const meta = await lerMeta();
  await writeFile(JSON_SEED, JSON.stringify(montarJson(meta, cartas), null, 2) + '\n', 'utf8');
  console.log(`data/cards.seed.json gerado a partir do CSV: ${cartas.length} cartas.`);
} else if (comando === 'conferir') {
  const cartas = await lerCartas();
  const meta = await lerMeta();
  const esperado = JSON.stringify(montarJson(meta, cartas), null, 2) + '\n';
  const atual = await readFile(JSON_SEED, 'utf8');
  if (esperado !== atual) {
    console.error('cards.seed.json está fora de sincronia com cards.csv.');
    console.error('Rode: node tools/cards-csv.mjs importar');
    process.exit(1);
  }
  console.log(`cards.csv e cards.seed.json estão em sincronia (${cartas.length} cartas).`);
} else {
  console.error('uso: node tools/cards-csv.mjs [exportar|importar|conferir]');
  process.exit(2);
}
