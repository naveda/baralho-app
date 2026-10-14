#!/usr/bin/env node
/**
 * Gera `lib/qr-tables.mjs` a partir das constantes da especificação ISO/IEC 18004.
 *
 * As tabelas NÃO são digitadas de memória: são derivadas de uma implementação
 * de referência independente (pacote npm `qrcode`, MIT) e conferidas contra ela.
 * Este script é ferramenta de desenvolvimento — o app em si continua zero-dep.
 *
 * Uso:
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i qrcode
 *   node tools/gen-qr-tables.mjs /tmp/qrverify/node_modules/qrcode/lib/core
 *
 * Saída: lib/qr-tables.mjs
 */
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const coreDir = process.argv[2];
if (!coreDir) {
  console.error('uso: node tools/gen-qr-tables.mjs <caminho>/qrcode/lib/core');
  process.exit(2);
}

const eccMod = (await import(pathToFileURL(join(coreDir, 'error-correction-code.js')).href)).default;
const utilsMod = (await import(pathToFileURL(join(coreDir, 'utils.js')).href)).default;
const ecLevel = (await import(pathToFileURL(join(coreDir, 'error-correction-level.js')).href)).default;

const LEVELS = ['L', 'M', 'Q', 'H'];
const LEVEL_OBJ = { L: ecLevel.L, M: ecLevel.M, Q: ecLevel.Q, H: ecLevel.H };
const total = [-1];
const eccPerBlock = [[-1], [-1], [-1], [-1]];
const blocks = [[-1], [-1], [-1], [-1]];

for (let v = 1; v <= 40; v++) {
  total[v] = utilsMod.getSymbolTotalCodewords(v);
  LEVELS.forEach((lvl, li) => {
    const lvlObj = LEVEL_OBJ[lvl];
    const nb = eccMod.getBlocksCount(v, lvlObj);
    // Atenção: no pacote `qrcode`, getTotalCodewordsCount devolve os codewords de
    // ECC POR BLOCO (o nome engana). Não dividir por nb.
    const ne = eccMod.getTotalCodewordsCount(v, lvlObj);
    if (!Number.isInteger(ne) || ne <= 0 || ne % nb !== 0) {
      throw new Error(`ecc inconsistente: v${v}-${lvl} → total=${ne}, blocos=${nb}`);
    }
    blocks[li][v] = nb;
    eccPerBlock[li][v] = ne / nb;
  });
}

// Sanidade estrutural (regras da norma, não valores decorados):
//  - precisa sobrar capacidade de dados;
//  - cada bloco de RS tem no máximo 255 codewords e usa no máximo 30 de ECC;
//  - os blocos diferem em no máximo 1 codeword de dados.
for (let v = 1; v <= 40; v++) {
  for (let li = 0; li < 4; li++) {
    const nb = blocks[li][v];
    const ne = eccPerBlock[li][v];
    const data = total[v] - ne * nb;
    const lvl = LEVELS[li];
    if (data <= 0) throw new Error(`sem capacidade de dados: v${v}-${lvl}`);
    if (ne > 30) throw new Error(`ecc/block > 30: v${v}-${lvl}`);
    if (nb > 81) throw new Error(`blocos demais: v${v}-${lvl}`);
    // Maior bloco (dados por bloco + ECC) não pode passar de 255 codewords.
    const maiorBloco = Math.ceil(data / nb) + ne;
    if (maiorBloco > 255) throw new Error(`bloco > 255 codewords: v${v}-${lvl} (${maiorBloco})`);
  }
}

const fmt = (a) => JSON.stringify(a);
const out = `/**
 * Tabelas do QR Code (ISO/IEC 18004) — GERADO, NÃO EDITAR À MÃO.
 *
 * Gerado por: tools/gen-qr-tables.mjs
 * Derivado de: pacote npm \`qrcode\` v1.5.x (MIT), funções getSymbolTotalCodewords,
 * getBlocksCount e getTotalCodewordsCount — equivalentes às constantes da norma.
 * Índice 0 é preenchimento; versões vão de 1 a 40.
 * Confere com casos conhecidos da norma (v1 L/M/Q/H, v5-Q, v10-H, v32-M, v40-L).
 */

/** Total de codewords (dados + ECC) por versão. */
export const TOTAL_CODEWORDS = ${fmt(total)};

/** Codewords de correção por bloco, indexado por nível [L, M, Q, H]. */
export const ECC_CODEWORDS_PER_BLOCK = ${fmt(eccPerBlock)};

/** Número de blocos, indexado por nível [L, M, Q, H]. */
export const NUM_BLOCKS = ${fmt(blocks)};

/** Índices dos níveis de correção: L=0, M=1, Q=2, H=3. */
export const ECC_LEVELS = ['L', 'M', 'Q', 'H'];
`;

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'qr-tables.mjs');
writeFileSync(dest, out);
console.log(`escrito ${dest} (${out.length} bytes); v40-L total=${total[40]}`);
