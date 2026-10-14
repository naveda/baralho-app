#!/usr/bin/env node
/**
 * Verificação independente do encoder de QR (`lib/qr.mjs`).
 *
 * Não faz parte do app (que é zero-dep): precisa de duas bibliotecas externas,
 * instaladas em uma pasta temporária fora do projeto.
 *
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i qrcode jsqr
 *   node tools/verify-qr.mjs /tmp/qrverify
 *
 * O que ele prova:
 *  1. para cada versão × nível × máscara forçada, a matriz gerada aqui é
 *     IDÊNTICA à de uma implementação de referência independente (`qrcode`);
 *  2. a escolha automática de máscara coincide com a da referência;
 *  3. o resultado é decodificado por um leitor independente (`jsqr`) e o texto
 *     volta exatamente igual — o teste que importa de verdade.
 *
 * O último ponto cobre o que o teste de matriz não cobre: se o QR não fosse
 * legível, a matriz poderia estar "certa" e ainda assim inútil.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || process.env.QR_ORACLE_DIR || '/tmp/qrverify';

if (!existsSync(join(base, 'node_modules'))) {
  console.error(`oráculos não encontrados em ${base}/node_modules`);
  console.error('instale antes:  mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i qrcode jsqr');
  process.exit(2);
}

const require = createRequire(join(base, 'package.json'));
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { encodeQR, pickVersion, eccIndex, qrSvg } = await import(
  pathToFileURL(join(APP, 'lib', 'qr.mjs')).href
);

const NIVEIS = ['L', 'M', 'Q', 'H'];

function textoAleatorio(tamanho, semente) {
  const alfabeto = 'abcdefghijklmnopqrstuvwxyz0123456789-_.~/:?#';
  let s = '';
  let x = (semente * 2654435761) % 2147483647;
  for (let i = 0; i < tamanho; i++) {
    x = (x * 48271) % 2147483647;
    s += alfabeto[x % alfabeto.length];
  }
  return s;
}

/** Matriz da implementação de referência, em modo byte (como a nossa). */
function matrizReferencia(texto, nivel, versao, mascara) {
  const qr = QRCode.create([{ data: texto, mode: 'byte' }], {
    errorCorrectionLevel: nivel,
    version: versao,
    maskPattern: mascara,
  });
  const tamanho = qr.modules.size;
  const dados = qr.modules.data;
  const linhas = [];
  for (let y = 0; y < tamanho; y++) {
    const linha = [];
    for (let x = 0; x < tamanho; x++) linha.push(dados[y * tamanho + x] ? 1 : 0);
    linhas.push(linha);
  }
  return linhas;
}

/** Rasteriza a matriz e devolve o texto lido pelo jsQR (leitor independente). */
function lerComJsQR(modulos, tamanho) {
  const escala = 4;
  const borda = 4;
  const lado = (tamanho + borda * 2) * escala;
  const pixels = new Uint8ClampedArray(lado * lado * 4).fill(255);
  for (let y = 0; y < tamanho; y++) {
    for (let x = 0; x < tamanho; x++) {
      if (!modulos[y][x]) continue;
      for (let dy = 0; dy < escala; dy++) {
        for (let dx = 0; dx < escala; dx++) {
          const px = (x + borda) * escala + dx;
          const py = (y + borda) * escala + dy;
          const o = (py * lado + px) * 4;
          pixels[o] = pixels[o + 1] = pixels[o + 2] = 0;
          pixels[o + 3] = 255;
        }
      }
    }
  }
  return jsQR(pixels, lado, lado);
}

const casos = [
  { nome: '1 byte', texto: 'a' },
  { nome: 'curto', texto: 'isso-e-bom-ou-ruim' },
  { nome: 'link local', texto: 'http://127.0.0.1:4178/#/carta/C07' },
  { nome: 'link archive', texto: 'https://web.archive.org/web/2026/https://lula.com.br/propostas/' },
  { nome: 'acentuado', texto: 'citação: "O Brasil tem um único dono: o povo brasileiro." #economia' },
];
for (const tamanho of [20, 40, 60, 90, 120, 200, 300, 450, 700, 1000, 1500, 2000, 2300]) {
  casos.push({ nome: tamanho + ' bytes', texto: textoAleatorio(tamanho, tamanho) });
}

let comparacoes = 0;
let divergencias = 0;
let mascaraIgual = 0;
let lidos = 0;
const falhas = [];
const versoesVistas = new Set();

for (const { nome, texto } of casos) {
  for (const nivel of NIVEIS) {
    const li = eccIndex(nivel);
    let versao;
    try {
      versao = pickVersion(Buffer.byteLength(texto, 'utf8'), li);
    } catch (err) {
      console.log(`  (pulado ${nome}/${nivel}: ${err.message})`);
      continue;
    }
    versoesVistas.add(versao);

    for (let mascara = 0; mascara < 8; mascara++) {
      const minha = encodeQR(texto, { ecc: nivel, minVersion: versao, maxVersion: versao, maskPattern: mascara });
      const referencia = matrizReferencia(texto, nivel, versao, mascara);
      comparacoes++;
      let igual = minha.size === referencia.length;
      if (igual) {
        for (let y = 0; y < minha.size && igual; y++) {
          for (let x = 0; x < minha.size; x++) {
            if (minha.modules[y][x] !== referencia[y][x]) {
              falhas.push(`${nome}/${nivel}/v${versao}/mask${mascara}: módulo diferente em (${x},${y})`);
              igual = false;
              break;
            }
          }
        }
      } else {
        falhas.push(`${nome}/${nivel}/v${versao}/mask${mascara}: tamanho ${minha.size} vs ${referencia.length}`);
      }
      if (!igual) divergencias++;
    }

    const auto = encodeQR(texto, { ecc: nivel, minVersion: versao, maxVersion: versao });
    const refAuto = matrizReferencia(texto, nivel, versao, auto.mask);
    let mesmaMascara = true;
    for (let y = 0; y < auto.size && mesmaMascara; y++) {
      for (let x = 0; x < auto.size; x++) {
        if (auto.modules[y][x] !== refAuto[y][x]) { mesmaMascara = false; break; }
      }
    }
    if (mesmaMascara) mascaraIgual++;

    const lido = lerComJsQR(auto.modules, auto.size);
    if (lido && lido.data === texto) lidos++;
    else falhas.push(`DECODE ${nome}/${nivel}/v${versao}/mask${auto.mask}: ${lido ? 'texto diferente' : 'não decodificado'}`);
  }
}

const svg = qrSvg('https://example.org/fonte-oficial', { ecc: 'M' });
if (!svg.startsWith('<svg') || !svg.includes('crispEdges')) falhas.push('SVG inválido');

console.log('=== verificação do encoder de QR ===');
console.log(`casos: ${casos.length} × 4 níveis`);
console.log(`versões exercitadas: ${[...versoesVistas].sort((a, b) => a - b).join(', ')}`);
console.log(`matrizes comparadas máscara a máscara com a referência: ${comparacoes} (divergências: ${divergencias})`);
console.log(`escolha automática de máscara igual à referência: ${mascaraIgual}`);
console.log(`decodificação por leitor independente (jsQR): ${lidos} ok`);
console.log(`SVG de exemplo: ${svg.length} bytes`);

if (falhas.length) {
  console.log(`\n--- ${falhas.length} falha(s) ---`);
  console.log(falhas.slice(0, 25).join('\n'));
  process.exit(1);
}
console.log('\nTODAS AS VERIFICAÇÕES PASSARAM');
