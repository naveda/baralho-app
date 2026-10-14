#!/usr/bin/env node
/**
 * Verificação da mesa — o baralho num navegador de verdade.
 *
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core
 *   node tools/verify-jogo.mjs /tmp/qrverify
 *
 * Sobe dois servidores sozinho — um com o fixture que tem links e outro com o
 * conjunto de pesquisa (cartas sem fonte) — para exercitar os dois versos.
 *
 * A checagem que mais importa: o nome do autor NÃO pode existir no DOM antes de
 * a carta ser virada. Se isso quebrar, o baralho perde o sentido.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || process.env.PLAYWRIGHT_DIR || '/tmp/qrverify';

if (!existsSync(join(base, 'node_modules', 'playwright-core'))) {
  console.error(`playwright-core não encontrado em ${base}/node_modules`);
  console.error('instale antes:  mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core');
  process.exit(2);
}

const require = createRequire(join(base, 'package.json'));
const { chromium, devices } = require('playwright-core');

// As cartas da mesa se sobrepõem de propósito: os testes clicam no ponto que
// acerta a carta, como um dedo, em vez de exigir o centro livre.
const { clicarNaCarta, cartasInalcancaveis, pontoAlcancavel } = await import('./comum.mjs');

const PORTA_COM_FONTE = Number(process.env.PORTA_JOGO_FONTE || 4181);
const PORTA_SEM_FONTE = Number(process.env.PORTA_JOGO_SEED || 4182);

let passou = 0;
const falhas = [];
const ok = (condicao, rotulo, extra = '') => {
  if (condicao) {
    passou++;
    console.log('  ✓ ' + rotulo);
  } else {
    falhas.push(rotulo + (extra ? ' — ' + extra : ''));
    console.log('  ✗ ' + rotulo + (extra ? ' — ' + extra : ''));
  }
};

const pedir = (porta, caminho) =>
  new Promise((resolver, rejeitar) => {
    const req = request({ host: '127.0.0.1', port: porta, path: caminho }, (res) => {
      res.resume();
      res.on('end', () => resolver(res.statusCode));
    });
    req.on('error', rejeitar);
    req.end();
  });

async function esperar(porta, tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      if ((await pedir(porta, '/api/health')) === 200) return true;
    } catch {
      /* subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const servidores = [
  spawn(process.execPath, [join(APP, 'web', 'server.mjs')], {
    env: { ...process.env, BARALHO_PORT: String(PORTA_COM_FONTE), BARALHO_DATA: 'cards.demo.json', BARALHO_CURADORIA: 'curadoria.vazia.json' },
    stdio: 'ignore',
  }),
  spawn(process.execPath, [join(APP, 'web', 'server.mjs')], {
    // Fixture próprio: o conjunto real muda a cada rodada de curadoria, e o
    // teste do caminho "sem fonte" não pode depender de qual tema está pendente.
    env: { ...process.env, BARALHO_PORT: String(PORTA_SEM_FONTE), BARALHO_DATA: 'cards.semfonte.json', BARALHO_CURADORIA: 'curadoria.vazia.json' },
    stdio: 'ignore',
  }),
];

const url = (porta, caminho = '/jogo.html') => `http://127.0.0.1:${porta}${caminho}`;
const navegador = await chromium.launch({ channel: 'chrome', headless: true });
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
const pagina = await contexto.newPage();
const erros = [];
pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push('console: ' + m.text());
});

const htmlTemAutor = async (alvo) => {
  const html = await alvo.content();
  return ['LULA', 'Flávio Bolsonaro', 'Luiz Inácio'].some((n) => html.includes(n));
};

try {
  ok((await esperar(PORTA_COM_FONTE)) && (await esperar(PORTA_SEM_FONTE)), 'os dois servidores respondem');

  /* ---------------- a mesa, com fontes ---------------- */
  await pagina.goto(url(PORTA_COM_FONTE, '/jogo.html?seed=mesa'), { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.carta-mesa');

  ok((await pagina.locator('.aba-tema').count()) >= 2, 'os temas existem no painel');
  ok(await pagina.locator('#painel').isHidden(), 'o painel de ajustes começa fechado');
  ok(await pagina.locator('#engrenagem').isVisible(), 'a engrenagem fica visível na mesa');
  // Regressão: a engrenagem já ficou sem estilo e caiu no canto errado.
  const cxEng = await pagina.locator('#engrenagem').boundingBox();
  const janela = pagina.viewportSize();
  ok(cxEng && cxEng.x + cxEng.width > janela.width * 0.9, 'a engrenagem fica no canto direito',
     cxEng ? `x=${Math.round(cxEng.x)} w=${Math.round(cxEng.width)} de ${janela.width}` : 'sem caixa');
  ok(cxEng && cxEng.y < 60 && cxEng.width <= 60, 'a engrenagem é um botão pequeno no topo',
     cxEng ? `y=${Math.round(cxEng.y)} w=${Math.round(cxEng.width)}` : 'sem caixa');
  ok((await pagina.locator('.sr-apenas').first().boundingBox()).width <= 2,
     'o rótulo acessível da engrenagem não aparece na tela');
  ok((await pagina.locator('.barra').count()) === 0, 'a barra de navegação saiu da mesa');
  ok((await pagina.locator('.carta-mesa').count()) >= 2, 'as cartas estão distribuídas na mesa');
  ok(await pagina.locator('#carta').isHidden(), 'a mesa começa sem carta no centro');
  const distribuídas = await pagina.locator('.carta-mesa').count();
  ok(!(await htmlTemAutor(pagina)), 'nenhum nome de autor no HTML com as cartas na mesa');
  await pagina.screenshot({ path: '/tmp/baralho_png/jogo-mesa.png' });

  /* ---------------- escolher uma carta ---------------- */
  const primeiroId = await pagina.locator('.carta-mesa').first().getAttribute('data-id');
  ok(await clicarNaCarta(pagina, primeiroId), 'a primeira carta da mesa é alcançável');
  await pagina.waitForTimeout(650);
  ok(await pagina.locator('#carta').isVisible(), 'a carta escolhida vem para o centro');
  ok((await pagina.locator('.carta-mesa.vista').count()) === 1, 'a carta usada fica marcada na mesa');
  const citacao = await pagina.textContent('#citacao');
  ok(citacao.length > 5 && citacao.startsWith('“'), 'a frente mostra a citação', citacao.slice(0, 40));
  ok(((await pagina.locator('.carta__indice b').first().textContent()) || '').length > 0, 'a frente tem o índice');
  ok(await pagina.locator('.carta__pergunta').isVisible(), 'a pergunta está impressa na carta');
  ok((await pagina.textContent('#fonte')).trim() === '', 'o verso ainda está vazio');
  ok(!(await htmlTemAutor(pagina)), 'nenhum nome de autor antes de virar');
  await pagina.screenshot({ path: '/tmp/baralho_png/jogo-frente.png' });

  await pagina.click('#carta');
  await pagina.waitForTimeout(850);
  ok((await pagina.locator('#carta.virada').count()) === 1, 'clicar na carta vira');
  const autor = (await pagina.locator('.carta__autor').textContent()) || '';
  ok(autor.trim().length > 3, 'o autor aparece no verso', autor);
  ok((await pagina.locator('.carta__qr svg').count()) === 1, 'o verso traz o QR da fonte');
  ok((await pagina.locator('.carta__qr svg.qr-carta').count()) === 1, 'o QR é desenhado como carta', 'classe qr-carta');
  const href = await pagina.locator('.carta__fonte-link').getAttribute('href');
  ok(/^https?:\/\//.test(href || ''), 'a fonte é um link clicável', String(href));
  ok((await pagina.locator('.carta__fonte-link .carta__qr svg').count()) === 1,
     'o QR faz parte do mesmo alvo clicável da fonte');
  await pagina.screenshot({ path: '/tmp/baralho_png/jogo-verso.png' });

  /* ---------------- nenhuma carta some atrás da escolhida ---------------- */
  // Estado limpo: mesa nova e uma carta efetivamente escolhida, com tempo para
  // a animação de reposicionamento terminar.
  await pagina.keyboard.press('s');
  await pagina.waitForTimeout(650);
  await pagina.locator('.carta-mesa').first().click();
  await pagina.waitForTimeout(1000);
  ok(await pagina.locator('#carta').isVisible(), 'a carta escolhida está visível para o teste de geometria');

  const inalcancaveis = await cartasInalcancaveis(pagina);
  ok(inalcancaveis.length === 0, 'nenhuma carta espalhada fica inteiramente escondida',
     inalcancaveis.join(' '));
  const foraDaTela = await pagina.evaluate(() =>
    [...document.querySelectorAll('.carta-mesa')].filter((n) => {
      const b = n.getBoundingClientRect();
      return b.x < -1 || b.y < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1;
    }).length);
  ok(foraDaTela === 0, 'nenhuma carta espalhada sai da tela', String(foraDaTela));

  // Diagnóstico opcional: DIAG=1 node tools/verify-jogo.mjs
  if (process.env.DIAG) {
    const d = await pagina.evaluate(() => {
      const caixas = [...document.querySelectorAll('.carta-mesa')].map((n) => {
        const r = n.getBoundingClientRect();
        return { id: n.dataset.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), r: n.style.getPropertyValue('--r') };
      });
      const g = document.querySelector('#carta').getBoundingClientRect();
      return { caixas, grande: { x: Math.round(g.x), y: Math.round(g.y), w: Math.round(g.width), h: Math.round(g.height) }, varAlt: document.querySelector('.mao').style.getPropertyValue('--altura-carta') };
    });
    console.log('  [diag] altura da carta espalhada:', d.varAlt, '| grande:', JSON.stringify(d.grande));
    for (const c of d.caixas) console.log('  [diag]', JSON.stringify(c));
    const alvos = await pagina.evaluate(() =>
      [...document.querySelectorAll('.carta-mesa')].map((n) => {
        const b = n.getBoundingClientRect();
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const el = document.elementFromPoint(cx, cy);
        const dono = el ? (el.closest('.carta-mesa')?.dataset.id || el.id || el.className) : 'nada';
        let pontos = 0;
        for (let j = 1; j <= 13; j++) for (let i = 1; i <= 13; i++) {
          const x = b.x + (b.width * i) / 14;
          const y = b.y + (b.height * j) / 14;
          if (x < 1 || y < 1 || x > innerWidth - 1 || y > innerHeight - 1) continue;
          const e2 = document.elementFromPoint(x, y);
          if (e2 && (e2 === n || n.contains(e2))) pontos++;
        }
        return { id: n.dataset.id, centroDe: dono, pontos };
      })
    );
    for (const a of alvos) console.log('  [diag] centro de', a.id, '->', a.centroDe, '| pontos livres:', a.pontos);
  }

  // e todas precisam ser clicáveis de verdade — uma por uma, pelo id
  const idsNaMesa = await pagina.$$eval('.carta-mesa', (ns) => ns.map((n) => n.dataset.id));
  let clicaveis = 0;
  for (const id of idsNaMesa) {
    // `clicarNaCarta` devolve false quando não acha ponto próprio: a carta está
    // coberta. Contar isso como sucesso esconderia o problema.
    // Esperar a reposição terminar: escolher uma carta faz as outras se moverem
    // (transição de 320 ms). Medir no meio do movimento acusa sobreposição que
    // não existe no repouso — foi o que fazia este teste falhar de vez em quando.
    const achou = await pontoAlcancavel(pagina, `.carta-mesa[data-id="${id}"]`);
    const clicou = await clicarNaCarta(pagina, id);
    await pagina.waitForTimeout(450);
    const marcada = await pagina.locator(`.carta-mesa[data-id="${id}"].vista`).count();
    if (process.env.DIAG) {
      console.log('  [passeio]', id, '| ponto:', achou ? 'sim' : 'NÃO', '| clicou:', clicou, '| marcada:', marcada);
    }
    if (clicou && marcada) clicaveis++;
  }
  ok(clicaveis === idsNaMesa.length, 'todas as cartas da mesa são alcançáveis',
     `${clicaveis} de ${idsNaMesa.length}`);
  const idsEscolhidos = await pagina.$$eval('.carta-mesa.vista', (ns) => ns.length);
  ok(idsEscolhidos === idsNaMesa.length, 'cada carta clicada é marcada como usada',
     `${idsEscolhidos} de ${idsNaMesa.length}`);

  // O passeio acima marcou todas as cartas da mesa. Embaralha para ter mesa
  // nova, escolhe uma e vira — é o estado de que o teste do link precisa.
  await pagina.keyboard.press('s');
  await pagina.waitForTimeout(650);
  await clicarNaCarta(pagina, await pagina.locator('.carta-mesa').first().getAttribute('data-id'));
  await pagina.waitForTimeout(700);
  await pagina.click('#carta');
  await pagina.waitForTimeout(850);
  ok((await pagina.locator('.carta__fonte-link').count()) === 1,
     'depois de embaralhar e escolher, o verso traz a fonte');

  /* ---------------- o link leva mesmo à fonte ---------------- */
  // `page` no contexto é mais confiável que o evento `popup` da página
  const [abaFonte] = await Promise.all([
    contexto.waitForEvent('page', { timeout: 15000 }).catch(() => null),
    pagina.locator('.carta__fonte-link').first().click(),
  ]);
  ok(abaFonte !== null, 'clicar na fonte abre a página em outra aba');
  if (abaFonte) {
    const urlFonte = abaFonte.url();
    ok(/^https?:\/\//.test(urlFonte), 'a fonte abre numa URL http(s)', urlFonte);
    await abaFonte.close();
  }
  ok((await pagina.locator('#carta.virada').count()) === 1,
     'clicar no link não desvira a carta');
  ok(await pagina.locator('#carta').isVisible(),
     'clicar no link não devolve a carta à mesa');

  /* ---------------- clicar fora devolve a carta à mesa ---------------- */
  // O ponto tem de ser feltro DENTRO do container das cartas: era ali que o
  // clique era engolido, e o teste antigo achava um ponto fora e passava.
  const pontoLivre = await pagina.evaluate(() => {
    const zona = document.querySelector('.mao').getBoundingClientRect();
    const obstaculos = [...document.querySelectorAll('.carta-mesa')].map((n) => n.getBoundingClientRect());
    const grande = document.querySelector('#carta');
    if (!grande.hidden) obstaculos.push(grande.getBoundingClientRect());
    for (let y = Math.round(zona.y) + 12; y < zona.bottom - 12; y += 13) {
      for (let x = Math.round(zona.x) + 12; x < zona.right - 12; x += 13) {
        const dentro = obstaculos.some((b) => x >= b.x - 8 && x <= b.right + 8 && y >= b.y - 8 && y <= b.bottom + 8);
        if (!dentro) return { x, y };
      }
    }
    return null;
  });
  ok(pontoLivre !== null, 'há feltro livre dentro da área das cartas para clicar');
  await pagina.mouse.click(pontoLivre.x, pontoLivre.y);
  await pagina.waitForTimeout(650);
  ok(await pagina.locator('#carta').isHidden(), 'clicar no feltro devolve a carta à mesa');
  ok((await pagina.locator('.carta-mesa.vista').count()) === 0,
     'a carta devolvida volta a ficar disponível na mesa');
  ok(!(await htmlTemAutor(pagina)), 'e o autor sai do DOM ao devolver');
  ok((await pagina.locator('.carta-mesa').count()) >= 2, 'a mesa continua espalhada');
  await pagina.screenshot({ path: '/tmp/baralho_png/jogo-devolvida.png' });

  // Esc também devolve
  await clicarNaCarta(pagina, await pagina.locator('.carta-mesa').first().getAttribute('data-id'));
  await pagina.waitForTimeout(600);
  ok(await pagina.locator('#carta').isVisible(), 'escolher de novo funciona');
  await pagina.keyboard.press('Escape');
  await pagina.waitForTimeout(600);
  ok(await pagina.locator('#carta').isHidden(), 'Esc também devolve a carta à mesa');

  // toda a área visível da carta responde ao clique
  const pontos = [[0.5, 0.5], [0.08, 0.08], [0.92, 0.92], [0.5, 0.06], [0.94, 0.5]];
  let viram = 0;
  for (const [fx, fy] of pontos) {
    await clicarNaCarta(pagina, await pagina.locator('.carta-mesa').first().getAttribute('data-id'));
    await pagina.waitForTimeout(420);
    const alvo = await pagina.evaluate(([fx, fy]) => {
      const b = document.querySelector('#carta').getBoundingClientRect();
      return { x: b.x + b.width * fx, y: b.y + b.height * fy };
    }, [fx, fy]);
    await pagina.mouse.click(alvo.x, alvo.y);
    await pagina.waitForTimeout(480);
    if ((await pagina.locator('#carta.virada').count()) === 1) viram++;
  }
  ok(viram === pontos.length, 'qualquer ponto da área visível da carta vira',
     `${viram} de ${pontos.length}`);

  // clicar numa carta da mesa não pode devolver
  await clicarNaCarta(pagina, await pagina.locator('.carta-mesa').first().getAttribute('data-id'));
  await pagina.waitForTimeout(600);
  await clicarNaCarta(pagina, await pagina.locator('.carta-mesa').nth(1).getAttribute('data-id'));
  await pagina.waitForTimeout(600);
  ok(await pagina.locator('#carta').isVisible(), 'clicar noutra carta da mesa troca, não devolve');
  ok((await pagina.locator('#carta.virada').count()) === 0, 'e a carta nova chega fechada');

  /* ---------------- escolher outra carta ---------------- */
  const citacao1 = citacao;
  await clicarNaCarta(pagina, await pagina.locator('.carta-mesa:not(.vista)').first().getAttribute('data-id'));
  await pagina.waitForTimeout(650);
  ok((await pagina.locator('#carta.virada').count()) === 0, 'a carta nova começa fechada');
  ok((await pagina.textContent('#fonte')).trim() === '', 'o verso é limpo ao trocar de carta');
  ok(!(await htmlTemAutor(pagina)), 'e o autor some do DOM');
  const citacao2 = await pagina.textContent('#citacao');
  ok(citacao2 !== citacao1, 'é outra citação', citacao2.slice(0, 30));

  /* ---------------- teclado e monte ---------------- */
  await pagina.keyboard.press('ArrowRight');
  await pagina.waitForTimeout(500);
  const citacao3 = await pagina.textContent('#citacao');
  ok(citacao3 !== citacao2, '→ passa para outra carta da mesa', citacao3.slice(0, 30));
  await pagina.keyboard.press('ArrowLeft');
  await pagina.waitForTimeout(500);
  ok((await pagina.textContent('#citacao')) === citacao2, '← volta para a anterior');

  await pagina.keyboard.press('s');
  await pagina.waitForTimeout(600);
  ok(await pagina.locator('#carta').isHidden(), 'S embaralha e recolhe a mesa');
  ok((await pagina.locator('.carta-mesa.vista').count()) === 0, 'a mesa volta limpa');
  ok((await pagina.locator('.carta-mesa').count()) === distribuídas, 'e com o mesmo número de cartas');

  await pagina.click('#monte');
  await pagina.waitForTimeout(500);
  ok((await pagina.locator('.carta-mesa').count()) >= 2, 'o monte distribui novas cartas');
  ok(await pagina.locator('#carta').isHidden(), 'sem carta no centro depois de redistribuir');

  /* ---------------- engrenagem: temas e navegação ---------------- */
  await pagina.click('#engrenagem');
  await pagina.waitForTimeout(300);
  ok(await pagina.locator('#painel').isVisible(), 'a engrenagem abre o painel');
  ok(await pagina.locator('#painel .aba-tema').first().isVisible(), 'os temas ficam no painel');
  ok((await pagina.locator('#painel .painel__links a').count()) >= 3, 'a navegação fica no painel');
  await pagina.screenshot({ path: '/tmp/baralho_png/jogo-engrenagem.png' });

  const comTema = pagina.locator('.aba-tema').filter({ hasNotText: 'todos' }).first();
  await comTema.click();
  await pagina.waitForTimeout(600);
  ok((await pagina.locator('.aba-tema[aria-pressed="true"]').count()) === 1, 'uma aba fica marcada');
  ok((await pagina.locator('.carta-mesa').count()) >= 1, 'a mesa é redistribuída com o tema escolhido');
  await pagina.locator('.aba-tema', { hasText: 'todos' }).click();
  await pagina.waitForTimeout(500);
  ok((await pagina.locator('.carta-mesa').count()) >= 2, '"todos" redistribui o baralho inteiro');
  await pagina.keyboard.press('Escape');
  await pagina.waitForTimeout(250);
  ok(await pagina.locator('#painel').isHidden(), 'Esc fecha o painel');

  /* ---------------- conjunto sem fontes ---------------- */
  const pagina2 = await contexto.newPage();
  pagina2.on('pageerror', (e) => erros.push('pageerror(seed): ' + e.message));
  // Fixture com cartas sem link: o conjunto real muda a cada curadoria.
  await pagina2.goto(url(PORTA_SEM_FONTE, '/jogo.html'), { waitUntil: 'networkidle' });
  await pagina2.waitForSelector('.carta-mesa');
  await clicarNaCarta(pagina2, await pagina2.locator('.carta-mesa').first().getAttribute('data-id'));
  await pagina2.waitForTimeout(600);
  await pagina2.click('#carta');
  await pagina2.waitForTimeout(800);
  ok((await pagina2.locator('.carta__qr svg').count()) === 0, 'sem fonte, não inventa QR');
  ok((await pagina2.locator('.carta__qr--vazio').count()) === 1, 'mostra que a fonte não está anexada');
  ok((await pagina2.locator('.carta__carimbo').count()) === 1, 'carimba a carta como não verificada');

  /* ---------------- celular ---------------- */
  const contextoMobile = await navegador.newContext({ ...devices['iPhone 13'] });
  const m = await contextoMobile.newPage();
  m.on('pageerror', (e) => erros.push('pageerror(mobile): ' + e.message));
  await m.goto(url(PORTA_COM_FONTE, '/jogo.html'), { waitUntil: 'networkidle' });
  await m.waitForSelector('#monte');
  const larguraTela = devices['iPhone 13'].viewport.width;
  const alturaTela = devices['iPhone 13'].viewport.height;
  const semTransbordo = async (rotulo) => {
    const r = await m.evaluate(() => ({ s: document.documentElement.scrollWidth, i: window.innerWidth }));
    ok(r.s <= r.i + 1, `sem rolagem lateral no celular: ${rotulo}`, `${r.s} > ${r.i}`);
  };
  await semTransbordo('mesa distribuída');
  ok((await m.locator('.carta-mesa').count()) >= 2, 'a mesa é distribuída no celular');
  await m.locator('.carta-mesa').first().click();
  await m.waitForTimeout(700);
  await semTransbordo('carta escolhida');
  const caixa = await m.locator('#carta').boundingBox();
  ok(
    caixa && caixa.y >= -1 && caixa.y + caixa.height <= alturaTela + 1,
    'a carta cabe na altura da tela',
    caixa ? `y=${Math.round(caixa.y)} h=${Math.round(caixa.height)} de ${alturaTela}` : 'sem carta'
  );
  ok(caixa && caixa.width <= larguraTela + 1, 'a carta cabe na largura da tela', String(caixa && Math.round(caixa.width)));
  await m.click('#carta');
  await m.waitForTimeout(850);
  ok((await m.locator('#carta.virada').count()) === 1, 'a mesa funciona no celular');
  ok((await m.locator('.carta__qr svg, .carta__qr--vazio').count()) === 1, 'o verso mostra a fonte ou a ausência dela');
  await semTransbordo('carta virada');
  await m.screenshot({ path: '/tmp/baralho_png/jogo-celular.png' });

  ok(erros.length === 0, 'nenhum erro de JavaScript', erros.slice(0, 3).join(' | '));
} finally {
  await navegador.close();
  for (const s of servidores) s.kill('SIGTERM');
}

console.log('\n=== verificação da mesa (navegador) ===');
console.log('  ' + passou + ' verificações passaram');
if (falhas.length) {
  console.log('  ' + falhas.length + ' FALHA(S):');
  for (const f of falhas) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log('  tudo certo ✓');
