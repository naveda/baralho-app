/**
 * Operações de baralho — puras, zero dependências, rodam no Node e no navegador.
 * Nada aqui revela o autor: a filtragem só usa tema, status, número e texto.
 */

/** Remove acentos e caixa para comparação/busca. */
export function normalize(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Hash estável (FNV-1a de 32 bits) para transformar uma seed textual em número. */
export function hashSeed(seed) {
  let h = 0x811c9dc5;
  const s = String(seed ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** PRNG determinístico (mulberry32): mesma seed → mesma ordem. */
function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher–Yates. Com `seed`, o resultado é reproduzível (útil para reimprimir um
 * baralho exato ou repetir uma rodada). Com seed vazia, usa Math.random.
 */
export function shuffle(items, seed = '') {
  const out = items.slice();
  const rand = seed ? mulberry32(hashSeed(seed)) : Math.random;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Filtra cartas.
 * @param {Array} cards
 * @param {{topics?:string[], status?:string[], search?:string}} [opts]
 */
export function filterCards(cards, opts = {}) {
  const { topics = [], status = ['approved'], search = '' } = opts;
  const queried = normalize(search);
  const wantedTopics = new Set(topics.map((t) => normalize(t)));
  const wantedStatus = new Set(status);

  return cards.filter((card) => {
    if (!wantedStatus.has(card.status)) return false;
    if (wantedTopics.size && !wantedTopics.has(normalize(card.topic))) return false;
    if (queried) {
      const haystack = normalize(
        [card.quote, card.autor, card.topic, card.id, card.observacao].filter(Boolean).join(' ')
      );
      if (!haystack.includes(queried)) return false;
    }
    return true;
  });
}

/**
 * Ordena para impressão/jogo.
 * @param {Array} cards
 * @param {{order?:'numero'|'id'|'tema'|'embaralhado', seed?:string}} [opts]
 */
export function arrange(cards, opts = {}) {
  const { order = 'numero', seed = '' } = opts;
  const byNumero = (a, b) =>
    (a.numeroNaCarta ?? Number.MAX_SAFE_INTEGER) - (b.numeroNaCarta ?? Number.MAX_SAFE_INTEGER) ||
    String(a.id).localeCompare(String(b.id));

  switch (order) {
    case 'numero':
      return cards.slice().sort(byNumero);
    case 'id':
      return cards.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    case 'tema':
      return cards.slice().sort((a, b) => String(a.topic).localeCompare(String(b.topic)) || byNumero(a, b));
    case 'embaralhado':
      return shuffle(cards, seed);
    default:
      return cards.slice();
  }
}

/** Divide em grupos de tamanho `size` (último grupo pode ser menor). */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Completa com `null` até o múltiplo de `size` — preserva slots vazios na folha. */
export function padToMultiple(items, size) {
  const out = items.slice();
  while (out.length % size !== 0) out.push(null);
  return out;}

/**
 * Espelha a ordem das cartas do verso para que caiam atrás das frentes.
 * - borda longa (paisagem A4): espelha as LINHAS (vira de cima para baixo);
 * - borda curta: espelha as COLUNAS (vira da esquerda para a direita).
 * Aplica-se sobre uma lista já preenchida com `null`.
 */
export function mirrorForDuplex(flat, cols, rows, edge = 'longa') {
  const grid = chunk(flat, cols);
  while (grid.length < rows) grid.push(new Array(cols).fill(null));
  const mirrored =
    edge === 'curta' ? grid.map((row) => row.slice().reverse()) : grid.slice().reverse();
  return mirrored.flat();
}

const FORMATADOR_DIA = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Data da carta como ela deve aparecer, respeitando `dataPrecisao` para não
 * inventar precisão que a fonte não tem: "2026-10" vira "10/2026", nunca
 * "01/10/2026". Compartilhado entre a impressão e o jogo.
 */
export function textoData(card) {
  const precisao = card?.dataPrecisao || 'desconhecida';
  if (card?.data) {
    const bruto = String(card.data);
    if (precisao === 'ano' || /^\d{4}$/.test(bruto)) return bruto.slice(0, 4);
    if (precisao === 'mes' || /^\d{4}-\d{2}$/.test(bruto)) {
      const [ano, mes] = bruto.slice(0, 7).split('-');
      return mes + '/' + ano;
    }
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(bruto) ? bruto + 'T12:00:00' : bruto;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? bruto : FORMATADOR_DIA.format(d);
  }
  return precisao === 'desconhecida' ? 'data não confirmada' : 'data não informada';
}

export default {
  normalize,
  hashSeed,
  shuffle,
  filterCards,
  arrange,
  chunk,
  padToMultiple,
  mirrorForDuplex,
  textoData,
};
