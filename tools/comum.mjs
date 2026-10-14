/**
 * Utilidades compartilhadas pelos verificadores de navegador.
 *
 * Por que existem: as cartas da mesa se sobrepõem de propósito (é o que dá o ar
 * de baralho jogado). Com sobreposição, o centro de uma carta pode estar coberto
 * pela caixa girada da vizinha — e o `click()` do Playwright se recusa a clicar
 * aí. Um dedo, não: ele acerta a parte visível.
 *
 * Então os testes procuram um ponto que realmente acerta a carta e clicam nele.
 * A regra que eles verificam é **alcançabilidade**, não centro livre: toda carta
 * na mesa precisa ter uma parte própria para o dedo acertar.
 */

/**
 * Um ponto dentro da carta que o ponteiro realmente acerta nela.
 *
 * A varredura inclui o centro exato e vai do centro para fora: amostrar só uma
 * grade grossa dava falso negativo (a carta era alcançável e o teste dizia que
 * não), e aí a carta não era clicada.
 */
export async function pontoAlcancavel(pagina, seletor) {
  return pagina.evaluate((sel) => {
    const n = document.querySelector(sel);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    const pontos = [[0.5, 0.5]];
    for (let raio = 1; raio <= 5; raio++) {
      const d = raio / 12;
      for (const [dx, dy] of [[0, -d], [0, d], [-d, 0], [d, 0], [-d, -d], [d, d], [-d, d], [d, -d]]) {
        pontos.push([0.5 + dx, 0.5 + dy]);
      }
    }
    for (const [fx, fy] of pontos) {
      const x = b.x + b.width * fx;
      const y = b.y + b.height * fy;
      if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
      const el = document.elementFromPoint(x, y);
      if (el && (el === n || n.contains(el))) return { x, y };
    }
    return null;
  }, seletor);
}

/** Clica na carta pelo id, no ponto que acerta nela. */
export async function clicarNaCarta(pagina, id) {
  const ponto = await pontoAlcancavel(pagina, `.carta-mesa[data-id="${id}"]`);
  if (!ponto) return false;
  await pagina.mouse.click(ponto.x, ponto.y);
  return true;
}

/**
 * Cartas que não têm nenhum ponto próprio para o dedo — ou seja, estão
 * inteiramente cobertas por outra carta. Devolve os ids.
 */
export async function cartasInalcancaveis(pagina) {
  return pagina.evaluate(() => {
    const ruins = [];
    const cartas = [...document.querySelectorAll('.carta-mesa')];
    for (const n of cartas) {
      const b = n.getBoundingClientRect();
      let acertos = 0;
      // varredura fina: 13×13 cobrindo toda a caixa da carta
      for (let j = 1; j <= 13 && acertos < 2; j++) {
        for (let i = 1; i <= 13 && acertos < 2; i++) {
          const x = b.x + (b.width * i) / 14;
          const y = b.y + (b.height * j) / 14;
          if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
          const el = document.elementFromPoint(x, y);
          if (el && (el === n || n.contains(el))) acertos++;
        }
      }
      if (acertos === 0) ruins.push(n.dataset.id);
    }
    return ruins;
  });
}
