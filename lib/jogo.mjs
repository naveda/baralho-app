/**
 * O baralho do jogo — puro, zero dependências, roda no Node (testes) e no navegador.
 *
 * Não há métricas, placar nem julgamento registrado: o jogo é jogado ao vivo,
 * entre pessoas. Aqui só existe o baralho, a ordem das cartas e onde estamos.
 */
import { arrange, filterCards } from './deck.mjs';

/**
 * Monta o baralho: filtra por tema/status e ordena.
 * @param {Array} cartas já com o overlay de tópicos aplicado
 * @param {{temas?:string[], incluirRascunho?:boolean, ordem?:string, seed?:string, busca?:string}} [opcoes]
 */
export function montarBaralho(cartas, opcoes = {}) {
  const { temas = [], incluirRascunho = true, ordem = 'embaralhado', seed = '', busca = '' } = opcoes;
  const status = incluirRascunho ? ['approved', 'wait'] : ['approved'];
  return arrange(filterCards(cartas, { topics: temas, status, search: busca }), { order: ordem, seed });
}

/** Sessão nova: o baralho na ordem e a posição corrente. */
export function novaSessao(baralho, extras = {}) {
  return {
    seed: extras.seed || '',
    temas: extras.temas || [],
    ids: baralho.map((c) => c.id),
    indice: 0,
    total: baralho.length,
    fim: false,
  };
}

export function cartaAtual(sessao, baralho) {
  const id = sessao.indice < sessao.ids.length ? sessao.ids[sessao.indice] : null;
  return id ? baralho.find((c) => c.id === id) || null : null;
}

/** Quantas cartas ainda estão no monte (para o monte encolher na mesa). */
export function restantes(sessao) {
  return Math.max(0, sessao.total - sessao.indice - 1);
}

export function acabou(sessao) {
  return sessao.indice >= sessao.total;
}

/** Avança. Na última carta sinaliza `fim`, sem sair dela. */
export function avancar(sessao) {
  if (sessao.indice >= sessao.total - 1) return { ...sessao, fim: true };
  return { ...sessao, indice: sessao.indice + 1, fim: false };
}

export function retroceder(sessao) {
  return { ...sessao, indice: Math.max(0, sessao.indice - 1), fim: false };
}

/** Embaralha de novo as cartas já filtradas da sessão. */
export function reembaralhar(sessao, baralho, seed = '') {
  const porId = new Map(baralho.map((c) => [c.id, c]));
  const selecionadas = sessao.ids.map((id) => porId.get(id)).filter(Boolean);
  return novaSessao(arrange(selecionadas, { order: 'embaralhado', seed }), { seed, temas: sessao.temas });
}

export default {
  montarBaralho,
  novaSessao,
  cartaAtual,
  restantes,
  acabou,
  avancar,
  retroceder,
  reembaralhar,
};
