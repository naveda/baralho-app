/**
 * Encoder de QR Code — modo byte, versões 1–40, níveis L/M/Q/H.
 *
 * Zero dependências, ESM puro: roda no Node e no navegador sem alteração.
 * Implementa ISO/IEC 18004: modo byte (0100), contagem de caracteres, codewords
 * de dados, Reed–Solomon por bloco, entrelaçamento, padrões de função, máscaras
 * e informação de formato/versão.
 *
 * Verificação: `test/qr-oracle.mjs` compara, para cada versão × nível × máscara
 * forçada, a matriz gerada aqui com a de uma implementação independente, e
 * `test/qr-decode.mjs` decodifica o resultado com um leitor independente (jsQR).
 */

import { TOTAL_CODEWORDS, ECC_CODEWORDS_PER_BLOCK, NUM_BLOCKS, ECC_LEVELS } from './qr-tables.mjs';

/* ------------------------------------------------------------------ *
 * Corpo de Galois GF(2^8), polinômio primitivo 0x11D
 * ------------------------------------------------------------------ */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** Polinômio gerador de grau `degree`: ∏ (x − α^i), i = 0..degree−1. */
function rsGeneratorPoly(degree) {
  let g = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g;
}

const genCache = new Map();
function generator(degree) {
  let g = genCache.get(degree);
  if (!g) {
    g = rsGeneratorPoly(degree);
    genCache.set(degree, g);
  }
  return g;
}

/** Resto da divisão de `data`·x^degree pelo polinômio gerador (codewords ECC). */
function rsRemainder(data, degree) {
  const gen = generator(degree);
  const rem = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[degree - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < degree; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return rem;
}

/* ------------------------------------------------------------------ *
 * Estrutura de blocos e capacidade
 * ------------------------------------------------------------------ */

export function eccIndex(ecc) {
  const s = String(ecc).toUpperCase();
  if (s === 'L' || s === 'LOW') return 0;
  if (s === 'M' || s === 'MEDIUM') return 1;
  if (s === 'Q' || s === 'QUARTILE') return 2;
  if (s === 'H' || s === 'HIGH') return 3;
  throw new Error(`nível de correção inválido: ${ecc}`);
}

/** Codewords de dados disponíveis para (versão, nível). */
export function numDataCodewords(version, li) {
  return TOTAL_CODEWORDS[version] - ECC_CODEWORDS_PER_BLOCK[li][version] * NUM_BLOCKS[li][version];
}

/** Bits do contador de caracteres do modo byte: 8 bits até v9, 16 bits de v10 em diante. */
const charCountBits = (version) => (version <= 9 ? 8 : 16);

/** Menor versão que comporta `byteLen` bytes no nível dado. */
export function pickVersion(byteLen, li, minVersion = 1, maxVersion = 40) {
  for (let v = minVersion; v <= maxVersion; v++) {
    const cap = numDataCodewords(v, li) * 8;
    const needed = 4 + charCountBits(v) + byteLen * 8;
    if (needed <= cap) return v;
  }
  const max = numDataCodewords(maxVersion, li) - 1 - Math.ceil(charCountBits(maxVersion) / 8);
  throw new Error(
    `texto longo demais para QR (${byteLen} bytes; máximo ~${max} bytes na versão ${maxVersion}, nível ${ECC_LEVELS[li]})`
  );
}

/** Estrutura de blocos Reed–Solomon de (versão, nível). */
export function rsBlockStructure(version, li) {
  const nb = NUM_BLOCKS[li][version];
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[li][version];
  const dataTotal = numDataCodewords(version, li);
  const shortLen = Math.floor(dataTotal / nb);
  const numShort = nb - (dataTotal % nb);
  return { numBlocks: nb, eccPerBlock, dataTotal, shortLen, numShort };
}

/* ------------------------------------------------------------------ *
 * Fluxo de dados
 * ------------------------------------------------------------------ */

const utf8 = (s) => new TextEncoder().encode(s);

function buildDataCodewords(bytes, version, li) {
  const capBits = numDataCodewords(version, li) * 8;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // modo byte
  push(bytes.length, charCountBits(version));
  for (const b of bytes) push(b, 8);

  const terminator = Math.min(4, capBits - bits.length);
  for (let i = 0; i < terminator; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  const PAD = [0xec, 0x11];
  for (let i = 0; out.length < capBits / 8; i++) out.push(PAD[i % 2]);
  return out;
}

function addEccAndInterleave(data, version, li) {
  const { numBlocks, eccPerBlock, shortLen, numShort } = rsBlockStructure(version, li);
  const blocks = [];
  let pos = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen + (i < numShort ? 0 : 1);
    const chunk = data.slice(pos, pos + len);
    pos += len;
    blocks.push({ data: chunk, ecc: rsRemainder(chunk, eccPerBlock) });
  }

  const out = [];
  const maxDataLen = shortLen + (numShort === numBlocks ? 0 : 1);
  // Blocos curtos primeiro; blocos sem codeword na posição i são pulados.
  for (let i = 0; i < maxDataLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i < blocks[j].data.length) out.push(blocks[j].data[i]);
    }
  }
  for (let i = 0; i < eccPerBlock; i++) {
    for (let j = 0; j < numBlocks; j++) out.push(blocks[j].ecc[i]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Matriz
 * ------------------------------------------------------------------ */

const bit = (x, i) => ((x >>> i) & 1) !== 0;
// Bits do nível na informação de formato: L=1, M=0, Q=3, H=2.
const FORMAT_ECL_BITS = [1, 0, 3, 2];

/** Centros dos padrões de alinhamento (ISO/IEC 18004, anexo E). */
export function alignmentPositions(version) {
  if (version === 1) return [];
  const size = version * 4 + 17;
  const numAlign = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

/** Constrói a matriz final para uma máscara específica (0–7). */
function buildMatrixForMask(version, li, codewords, mask) {
  const size = version * 4 + 17;
  const mods = Array.from({ length: size }, () => new Uint8Array(size));
  const isFn = Array.from({ length: size }, () => new Uint8Array(size));

  const setFn = (x, y, dark) => {
    mods[y][x] = dark ? 1 : 0;
    isFn[y][x] = 1;
  };

  // Padrões de temporização (sobrescritos depois pelos localizadores).
  for (let i = 0; i < size; i++) {
    setFn(6, i, i % 2 === 0);
    setFn(i, 6, i % 2 === 0);
  }

  // Localizadores + separadores.
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);

  // Alinhamento.
  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const isCorner =
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0);
      if (isCorner) continue;
      const cx = align[i];
      const cy = align[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Informação de formato (15 bits, BCH(15,5), gerador 0x537, XOR 0x5412).
  const drawFormat = (m) => {
    const data = (FORMAT_ECL_BITS[li] << 3) | m;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;

    for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
    setFn(8, 7, bit(bits, 6));
    setFn(8, 8, bit(bits, 7));
    setFn(7, 8, bit(bits, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));

    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
    setFn(8, size - 8, true); // módulo sempre escuro
  };

  // Informação de versão (18 bits, BCH(18,6), gerador 0x1F25) para v ≥ 7.
  const drawVersion = () => {
    if (version < 7) return;
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = bit(bits, i);
      const a = size - 11 + (i % 3);
      const c = Math.floor(i / 3);
      setFn(a, c, b);
      setFn(c, a, b);
    }
  };

  drawFormat(mask);
  drawVersion();

  // Posicionamento dos codewords em zigue-zague, da direita para a esquerda.
  let idx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFn[y][x] && idx < totalBits) {
          mods[y][x] = bit(codewords[idx >>> 3], 7 - (idx & 7)) ? 1 : 0;
          idx++;
        }
      }
    }
  }

  // Máscara.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFn[y][x]) continue;
      let invert;
      switch (mask) {
        case 0: invert = (x + y) % 2 === 0; break;
        case 1: invert = y % 2 === 0; break;
        case 2: invert = x % 3 === 0; break;
        case 3: invert = (x + y) % 3 === 0; break;
        case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
        case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        default: throw new Error(`máscara inválida: ${mask}`);
      }
      if (invert) mods[y][x] ^= 1;
    }
  }

  return mods;
}

/** Penalidade da norma (N1=3, N2=3, N3=40, N4=10). */
function penalty(mods) {
  const size = mods.length;
  let score = 0;

  const runs = (get) => {
    for (let a = 0; a < size; a++) {
      let runColor = get(a, 0);
      let runLen = 1;
      for (let b = 1; b < size; b++) {
        const c = get(a, b);
        if (c === runColor) {
          runLen++;
          if (runLen === 5) score += 3;
          else if (runLen > 5) score += 1;
        } else {
          runColor = c;
          runLen = 1;
        }
      }
      // Padrão 1:1:3:1:1 com 4 módulos claros de um dos lados.
      let line = '';
      for (let b = 0; b < size; b++) line += get(a, b) ? '1' : '0';
      const padroes = ['10111010000', '00001011101'];
      for (const p of padroes) {
        let from = 0;
        for (;;) {
          const at = line.indexOf(p, from);
          if (at < 0) break;
          score += 40;
          from = at + 1;
        }
      }
    }
  };
  runs((a, b) => mods[a][b]); // linhas
  runs((a, b) => mods[b][a]); // colunas

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = mods[y][x];
      if (c === mods[y][x + 1] && c === mods[y + 1][x] && c === mods[y + 1][x + 1]) score += 3;
    }
  }

  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) dark += mods[y][x];
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  score += k * 10;

  return score;
}

/* ------------------------------------------------------------------ *
 * API pública
 * ------------------------------------------------------------------ */

/**
 * Codifica `text` (UTF-8, modo byte) em um QR Code.
 * @returns {{version:number,size:number,ecc:string,mask:number,modules:number[][]}}
 */
export function encodeQR(text, options = {}) {
  const { ecc = 'M', minVersion = 1, maxVersion = 40, maskPattern = -1 } = options;
  const li = eccIndex(ecc);
  const bytes = utf8(String(text));
  const version = pickVersion(bytes.length, li, minVersion, maxVersion);
  const codewords = addEccAndInterleave(buildDataCodewords(bytes, version, li), version, li);

  let mask = maskPattern;
  let mods;
  if (mask >= 0 && mask <= 7) {
    mods = buildMatrixForMask(version, li, codewords, mask);
  } else {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      const candidate = buildMatrixForMask(version, li, codewords, m);
      const s = penalty(candidate);
      if (s < best) {
        best = s;
        mods = candidate;
        mask = m;
      }
    }
  }

  return {
    version,
    size: mods.length,
    ecc: ECC_LEVELS[li],
    mask,
    modules: mods.map((row) => Array.from(row)),
  };
}

/**
 * QR Code como SVG pronto para impressão (módulos como retângulos exatos).
 * @param {string} text
 * @param {{ecc?:string, border?:number, scale?:number, dark?:string, light?:string,
 *          title?:string, className?:string, minVersion?:number, maxVersion?:number}} [options]
 */
export function qrSvg(text, options = {}) {
  const {
    ecc = 'M',
    border = 4,
    scale = 1,
    dark = '#000000',
    light = '#ffffff',
    title = 'QR Code',
    className = 'qr',
    minVersion = 1,
    maxVersion = 40,
  } = options;

  const { modules, size, version, mask } = encodeQR(text, { ecc, minVersion, maxVersion });
  const dim = size + border * 2;

  // Uma única path com os trechos escuros, para o SVG ficar pequeno.
  let d = '';
  for (let y = 0; y < size; y++) {
    let x = 0;
    while (x < size) {
      if (!modules[y][x]) { x++; continue; }
      let run = 0;
      while (x + run < size && modules[y][x + run]) run++;
      d += `M${x + border} ${y + border}h${run}v1h-${run}z`;
      x += run;
    }
  }

  const attrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `viewBox="0 0 ${dim} ${dim}"`,
    `width="${dim * scale}"`,
    `height="${dim * scale}"`,
    `class="${className}"`,
    `role="img"`,
    `aria-label="${escapeAttr(title)}"`,
    `data-qr-version="${version}"`,
    `data-qr-mask="${mask}"`,
  ].join(' ');

  return (
    `<svg ${attrs}>` +
    `<rect width="${dim}" height="${dim}" fill="${light}"/>` +
    `<path d="${d}" fill="${dark}" shape-rendering="crispEdges"/>` +
    `</svg>`
  );
}

const escapeAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ------------------------------------------------------------------ *
 * QR em forma de carta de baralho
 * ------------------------------------------------------------------ */

/** Áreas dos três localizadores (7×7), que ganham desenho próprio. */
function ehLocalizador(x, y, size) {
  const dentro = (cx, cy) => x >= cx && x < cx + 7 && y >= cy && y < cy + 7;
  return dentro(0, 0) || dentro(size - 7, 0) || dentro(0, size - 7);
}

const NAIPES = { espadas: '♠', copas: '♥', ouros: '♦', paus: '♣' };

/** Retângulo de cantos arredondados como caminho (geometria exata). */
function retanguloArredondado(x, y, w, h, r) {
  return (
    `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}` +
    `a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}` +
    `v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`
  );
}

/**
 * QR desenhado como carta de baralho: papel de fundo, moldura dourada, naipes
 * nos quatro cantos e módulos arredondados. Opcionalmente com um naipe no
 * centro, o que exige correção de erro H para o leitor não se perder.
 *
 * Regra que o desenho respeita (e que já foi violada uma vez aqui): a zona de
 * silêncio de 4 módulos em volta do código fica **limpa**; os enfeites vivem na
 * faixa da moldura, fora dela. E os localizadores usam geometria exata — traço
 * de 1 módulo centralizado na borda deforma a proporção 1:1:3:1:1 e o leitor
 * não acha o código.
 *
 * @param {string} texto
 * @param {{ecc?:string, naipe?:string|null, cor?:string, corNaipe?:string,
 *          papel?:string, moldura?:string, escala?:number, titulo?:string, className?:string}} [opcoes]
 */
export function qrSvgCarta(texto, opcoes = {}) {
  const {
    naipe = null,
    cor = '#1a1613',
    corNaipe = '#a51c17',
    papel = '#fffdf7',
    moldura = '#b9924a',
    escala = 1,
    titulo = 'Fonte',
    className = 'qr-carta',
  } = opcoes;

  const emblema = naipe ? NAIPES[naipe] || null : null;
  const ecc = opcoes.ecc || (emblema ? 'H' : 'Q');

  const { modules, size, version, mask } = encodeQR(texto, { ecc });
  const silencio = 4;   // zona de silêncio exigida pela norma — sempre limpa
  const faixa = 6;      // faixa decorativa, onde ficam moldura e naipes
  const offset = silencio + faixa;
  const dim = size + offset * 2;

  const partes = [];
  partes.push(`<rect width="${dim}" height="${dim}" rx="${(dim * 0.055).toFixed(2)}" fill="${papel}"/>`);
  partes.push(
    `<rect x="1.2" y="1.2" width="${(dim - 2.4).toFixed(2)}" height="${(dim - 2.4).toFixed(2)}" rx="${(dim * 0.05).toFixed(2)}" fill="none" stroke="${moldura}" stroke-width="1.2"/>`
  );

  // Módulos arredondados; os localizadores são desenhados à parte.
  let caminho = '';
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!modules[y][x] || ehLocalizador(x, y, size)) continue;
      caminho += retanguloArredondado(x + offset, y + offset, 1, 1, 0.24);
    }
  }
  partes.push(`<path d="${caminho}" fill="${cor}"/>`);

  // Localizadores: anel de exatamente 1 módulo + miolo de 3×3.
  const localizador = (cx, cy) => {
    const x = cx + offset;
    const y = cy + offset;
    return (
      `<path d="${retanguloArredondado(x, y, 7, 7, 1.3)} ${retanguloArredondado(x + 1, y + 1, 5, 5, 0.9)}" fill="${cor}" fill-rule="evenodd"/>` +
      `<rect x="${x + 2}" y="${y + 2}" width="3" height="3" rx="0.7" fill="${cor}"/>`
    );
  };
  partes.push(localizador(0, 0), localizador(size - 7, 0), localizador(0, size - 7));

  // Emblema central (opcional): área pequena, ECC alta.
  if (emblema) {
    const lado = Math.min(9, Math.max(5, Math.round(size * 0.18)));
    const cx = offset + size / 2;
    const cy = offset + size / 2;
    partes.push(
      `<path d="${retanguloArredondado(cx - lado / 2, cy - lado / 2, lado, lado, lado * 0.22)}" fill="${papel}" stroke="${moldura}" stroke-width="0.6"/>`
    );
    partes.push(
      `<text x="${cx}" y="${(cy + lado * 0.32).toFixed(2)}" font-size="${(lado * 0.8).toFixed(2)}" text-anchor="middle" fill="${corNaipe}" font-family="Georgia, 'Times New Roman', serif">${emblema}</text>`
    );
  }

  // Naipes nos quatro cantos, dentro da faixa decorativa.
  const centro = faixa / 2 + 0.6;
  const canto = (x, y) =>
    `<text x="${x}" y="${y}" font-size="${(faixa * 0.58).toFixed(2)}" text-anchor="middle" fill="${corNaipe}" font-family="Georgia, 'Times New Roman', serif">${emblema || '♠'}</text>`;
  partes.push(canto(centro, centro + 0.9));
  partes.push(canto(dim - centro, centro + 0.9));
  partes.push(canto(centro, dim - centro + 1.1));
  partes.push(canto(dim - centro, dim - centro + 1.1));

  const attrs = [
    `xmlns="http://www.w3.org/2000/svg"`,
    `viewBox="0 0 ${dim} ${dim}"`,
    `width="${(dim * escala).toFixed(2)}"`,
    `height="${(dim * escala).toFixed(2)}"`,
    `class="${className}"`,
    `role="img"`,
    `aria-label="${escapeAttr(titulo)}"`,
    `data-qr-version="${version}"`,
    `data-qr-mask="${mask}"`,
    `data-qr-ecc="${ecc}"`,
  ].join(' ');

  return `<svg ${attrs}>${partes.join('')}</svg>`;
}

export default { encodeQR, qrSvg, qrSvgCarta };
