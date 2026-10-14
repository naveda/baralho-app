/**
 * Tópicos editáveis pelo usuário — camada por cima da taxonomia base.
 *
 * O usuário pode:
 *  - **renomear** qualquer tema (nome exibido e etiqueta `#` da carta);
 *  - **criar** tópicos próprios, com símbolo e cor;
 *  - **atribuir** qualquer carta a qualquer tópico, em massa.
 *
 * O overlay é um objeto pequeno e serializável, guardado no aparelho
 * (localStorage) — nada vai para servidor. As funções aqui são puras, para
 * rodarem iguais no Node (testes) e no navegador.
 *
 * Chaves: uma carta aponta para uma **chave** de tópico, que é o slug base
 * (`economia`) ou o id de um tópico próprio (`t1`). O id é estável: renomear um
 * tópico próprio não quebra as atribuições já feitas.
 */

export const OVERLAY_VERSAO = 1;

export function overlayVazio() {
  return { version: OVERLAY_VERSAO, renomeados: {}, proprios: [], atribuicoes: {} };
}

/** "Educação e Cultura" → "educacao-e-cultura" */
export function slugificar(texto) {
  const slug = String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'topico';
}

/** Devolve um slug livre, acrescentando -2, -3… se preciso. */
export function slugUnico(base, usados = new Set()) {
  const slug = slugificar(base);
  if (!usados.has(slug)) return slug;
  let n = 2;
  while (usados.has(slug + '-' + n)) n++;
  return slug + '-' + n;
}

/** Lê um overlay de fora e devolve sempre uma estrutura válida. */
export function normalizarOverlay(bruto) {
  const limpo = overlayVazio();
  if (!bruto || typeof bruto !== 'object') return limpo;

  if (bruto.renomeados && typeof bruto.renomeados === 'object') {
    for (const [chave, valor] of Object.entries(bruto.renomeados)) {
      if (!valor || typeof valor !== 'object') continue;
      const label = typeof valor.label === 'string' ? valor.label.trim().slice(0, 60) : '';
      const slug = typeof valor.slug === 'string' && valor.slug ? slugificar(valor.slug) : slugificar(chave);
      const labelFinal = label || chave;
      // Só guarda o que de fato muda — overlay enxuto e legível.
      if (labelFinal !== chave || slug !== chave) limpo.renomeados[chave] = { label: labelFinal, slug };
    }
  }

  const idsVistos = new Set();
  if (Array.isArray(bruto.proprios)) {
    for (const t of bruto.proprios) {
      if (!t || typeof t !== 'object') continue;
      const label = String(t.label ?? '').trim().slice(0, 60);
      if (!label) continue;
      let id = String(t.id ?? '').trim();
      if (!id || idsVistos.has(id)) id = 't' + (idsVistos.size + 1);
      while (idsVistos.has(id)) id = id + 'x';
      idsVistos.add(id);
      limpo.proprios.push({
        id,
        label,
        slug: slugificar(t.slug || label),
        simbolo: typeof t.simbolo === 'string' && t.simbolo ? t.simbolo.slice(0, 2) : '◆',
        cor: t.cor === 'vermelho' ? 'vermelho' : 'preto',
      });
    }
  }

  const chavesValidas = new Set(limpo.proprios.map((t) => t.id));
  if (bruto.atribuicoes && typeof bruto.atribuicoes === 'object') {
    for (const [cardId, chave] of Object.entries(bruto.atribuicoes)) {
      if (typeof chave !== 'string' || !chave) continue;
      if (chavesValidas.has(chave) || /^[a-z0-9-]+$/.test(chave)) limpo.atribuicoes[cardId] = chave;
    }
  }
  return limpo;
}

/**
 * Tópico efetivo de uma carta: atribuição explícita > tema base (com renomeação).
 * @returns {{chave:string, slug:string, label:string, simbolo:string, cor:string, proprio:boolean}}
 */
export function resolverTopico(card, overlay, temasPorSlug = new Map()) {
  const chave = overlay.atribuicoes?.[card.id] ?? card.topic;
  const proprio = overlay.proprios?.find((t) => t.id === chave);
  if (proprio) {
    return {
      chave,
      slug: proprio.slug,
      label: proprio.label,
      simbolo: proprio.simbolo,
      cor: proprio.cor,
      proprio: true,
    };
  }
  const renomeado = overlay.renomeados?.[chave];
  const base = temasPorSlug.get(chave);
  return {
    chave,
    slug: renomeado?.slug || chave,
    label: renomeado?.label || base?.label || chave,
    simbolo: base?.simbolo || '♠',
    cor: base?.cor || 'preto',
    proprio: false,
  };
}

/** Cartas com `topic` trocado pelo slug efetivo e `_topico` com o resto. */
export function aplicarOverlay(cards, overlay, temasPorSlug = new Map()) {
  return cards.map((card) => {
    const topico = resolverTopico(card, overlay, temasPorSlug);
    return { ...card, topic: topico.slug, _topico: topico };
  });
}

/** Todos os slug efetivos em uso (para validar unicidade). */
export function slugsEmUso(overlay, temasBase = []) {
  const usados = new Set();
  for (const t of temasBase) {
    const base = typeof t === 'string' ? t : t.slug;
    usados.add(overlay.renomeados?.[base]?.slug || base);
  }
  for (const t of overlay.proprios || []) usados.add(t.slug);
  return usados;
}

/**
 * Lista de tópicos para os chips da impressão: base (renomeada), próprios e
 * eventuais temas órfãos vindos dos dados. Já com a contagem efetiva de cartas.
 */
export function listarTopicos(cards, overlay, temasBase = []) {
  const efetivas = aplicarOverlay(cards, overlay, new Map(temasBase.map((t) => [t.slug, t])));
  const contagem = new Map();
  for (const card of efetivas) contagem.set(card.topic, (contagem.get(card.topic) || 0) + 1);

  const itens = [];
  const vistos = new Set();
  for (const tema of temasBase) {
    const renomeado = overlay.renomeados?.[tema.slug];
    const slug = renomeado?.slug || tema.slug;
    if (vistos.has(slug)) continue;
    vistos.add(slug);
    itens.push({
      chave: tema.slug,
      slug,
      label: renomeado?.label || tema.label,
      simbolo: tema.simbolo,
      cor: tema.cor,
      proprio: false,
      total: contagem.get(slug) || 0,
    });
  }
  for (const tema of overlay.proprios || []) {
    if (vistos.has(tema.slug)) continue;
    vistos.add(tema.slug);
    itens.push({ ...tema, chave: tema.id, proprio: true, total: contagem.get(tema.slug) || 0 });
  }
  for (const [slug, total] of contagem) {
    if (vistos.has(slug)) continue;
    vistos.add(slug);
    itens.push({ chave: slug, slug, label: slug, simbolo: '♠', cor: 'preto', proprio: false, total });
  }
  return itens;
}

/** Quantas cartas têm o tópico efetivo igual a `slug`. */
export function contarPorSlug(cards, overlay, temasPorSlug = new Map()) {
  const contagem = new Map();
  for (const card of aplicarOverlay(cards, overlay, temasPorSlug)) {
    contagem.set(card.topic, (contagem.get(card.topic) || 0) + 1);
  }
  return contagem;
}

/** Próximo id livre de tópico próprio. */
export function proximoId(overlay) {
  let n = (overlay.proprios?.length || 0) + 1;
  const usados = new Set((overlay.proprios || []).map((t) => t.id));
  while (usados.has('t' + n)) n++;
  return 't' + n;
}

export default {
  OVERLAY_VERSAO,
  overlayVazio,
  slugificar,
  slugUnico,
  normalizarOverlay,
  resolverTopico,
  aplicarOverlay,
  slugsEmUso,
  listarTopicos,
  contarPorSlug,
  proximoId,
};
