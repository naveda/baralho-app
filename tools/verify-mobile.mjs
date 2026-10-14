#!/usr/bin/env node
/**
 * Verificação das telas de celular, com um navegador emulado de verdade.
 *
 * Não faz parte do app (que é zero-dep): precisa do Playwright.
 *
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core
 *   node baralho-app/web/server.mjs &
 *   node baralho-app/tools/verify-mobile.mjs /tmp/qrverify
 *
 * Confere, nas páginas: nada de rolagem lateral, alvos de toque, abas do
 * estúdio de impressão, a folha cabendo na tela, a barra fixa de atribuição nos
 * tópicos e os blocos de créditos.
 */
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || process.env.PLAYWRIGHT_DIR || '/tmp/qrverify';
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4178';

if (!existsSync(join(base, 'node_modules', 'playwright-core'))) {
  console.error(`playwright-core não encontrado em ${base}/node_modules`);
  console.error('instale antes:  mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core');
  process.exit(2);
}

const require = createRequire(join(base, 'package.json'));
const { chromium, devices } = require('playwright-core');

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

const navegador = await chromium.launch({ channel: 'chrome', headless: true });
const contexto = await navegador.newContext({ ...devices['iPhone 13'] });
const pagina = await contexto.newPage();
const LARGURA = devices['iPhone 13'].viewport.width;

const erros = [];
pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push('console: ' + m.text());
});

async function semTransbordo(rotulo) {
  const medidas = await pagina.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
  }));
  ok(medidas.scrollW <= medidas.innerW + 1, `sem rolagem lateral: ${rotulo}`, `${medidas.scrollW}px > ${medidas.innerW}px`);
}

async function alvosDeToque(seletor, minimo, rotulo) {
  const pequenos = await pagina.$$eval(seletor, (nos, min) =>
    nos
      .filter((n) => n.offsetParent !== null)
      .map((n) => ({ texto: (n.textContent || '').trim().slice(0, 24), altura: Math.round(n.getBoundingClientRect().height) }))
      .filter((n) => n.altura < min),
    minimo
  );
  ok(pequenos.length === 0, rotulo, pequenos.map((p) => `${p.texto}=${p.altura}px`).join(', '));
}

try {
  /* ------------------------------ início ------------------------------ */
  await pagina.goto(BASE_URL + '/', { waitUntil: 'networkidle' });
  await semTransbordo('início');
  ok((await pagina.locator('#creditos').count()) === 1, 'a página inicial tem a seção de créditos');
  const textoCreditos = await pagina.locator('#creditos').innerText();
  ok(textoCreditos.includes('Luiz Naveda'), 'crédito de autoria na página inicial');
  ok(/regiane/i.test(textoCreditos), 'crédito do baralho de referência');
  ok(/Vira Voto/.test(textoCreditos), 'referência ao baralho original na página inicial');
  ok((await pagina.locator('#creditos a[href="./creditos.html"]').count()) === 1, 'link para a página de créditos');
  await alvosDeToque('.botao', 44, 'botões da página inicial com alvo de toque adequado');
  ok((await pagina.locator('.cartao--destaque a[href="./jogo.html"]').count()) === 1, 'o jogo é o destaque da página inicial');
  await pagina.screenshot({ path: '/tmp/baralho_png/mobile-inicio.png', fullPage: true });

  /* -------------------------------- mesa ------------------------------ */
  await pagina.goto(BASE_URL + '/jogo.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.carta-mesa');
  await semTransbordo('mesa (cartas distribuídas)');
  await alvosDeToque('.aba-tema', 38, 'abas de tema com alvo de toque adequado');
  // Poucas cartas por mesa no celular, mas grandes: é o que faz a carta valer.
  const nCel = await pagina.locator('.carta-mesa').count();
  ok(nCel >= 3, 'as cartas são distribuídas no celular', String(nCel));
  const alturas = await pagina.$$eval('.carta-mesa', (ns) => ns.map((n) => Math.round(n.getBoundingClientRect().height)));
  ok(alturas.every((h) => h >= 100), 'cada carta da mesa tem ao menos 100 px de altura no celular',
     JSON.stringify(alturas));
  await pagina.locator('.carta-mesa').first().click();
  await pagina.waitForTimeout(700);
  await semTransbordo('mesa (carta escolhida)');
  const caixaCarta = await pagina.locator('#carta').boundingBox();
  ok(
    caixaCarta && caixaCarta.x >= -1 && caixaCarta.x + caixaCarta.width <= LARGURA + 1,
    'a carta do jogo cabe na largura da tela',
    caixaCarta ? `x=${Math.round(caixaCarta.x)} w=${Math.round(caixaCarta.width)} de ${LARGURA}` : 'sem carta'
  );
  await pagina.click('#carta');
  await pagina.waitForTimeout(850);
  ok((await pagina.locator('#carta.virada').count()) === 1, 'a carta vira no celular');
  await semTransbordo('mesa (carta virada)');

  /* ----------------------------- créditos ----------------------------- */
  await pagina.goto(BASE_URL + '/creditos.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.credito-bloco');
  await semTransbordo('créditos');
  const blocos = await pagina.locator('.credito-bloco').count();
  ok(blocos === 3, 'página de créditos traz 3 seções, enxuta', 'veio ' + blocos);
  ok((await pagina.locator('.credito-bloco--citacao').count()) === 0, 'sem ficha técnica nem "como citar"');
  // innerText devolve o texto já transformado pelo CSS (h2 em maiúsculas).
  const textoPagina = (await pagina.locator('#conteudo').innerText()).toLowerCase();
  for (const termo of ['Luiz Naveda', 'regiane', 'Vira Voto', 'pasta de origem']) {
    ok(textoPagina.includes(termo.toLowerCase()), `créditos mencionam ${termo}`);
  }
  ok(!/playwright|qrcode|jsqr|lgpd/i.test(textoPagina), 'créditos não entram em ficha técnica')
  ok((await pagina.locator('.credito-bloco--aviso').count()) === 1, 'seção de aviso destacada');
  ok((await pagina.locator('.ressalva').count()) >= 1, 'ressalva sobre o original presente');
  ok((await pagina.locator('.pessoa__links a').count()) >= 1, 'link do autor presente');
  await pagina.screenshot({ path: '/tmp/baralho_png/mobile-creditos.png', fullPage: false });

  /* --------------------------- impressão ------------------------------ */
  await pagina.goto(BASE_URL + '/print.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('#temas .chip');
  await semTransbordo('estúdio de impressão (ajustes)');

  ok(await pagina.locator('.abas').isVisible(), 'abas Ajustes/Prévia visíveis no celular');
  ok(await pagina.locator('#barra-mobile').isVisible(), 'barra fixa de ação visível no celular');
  ok(!(await pagina.locator('.btn--so-desktop').first().isVisible()), 'ações de desktop escondidas no celular');
  ok(await pagina.locator('#imprimir-mobile').isVisible(), 'botão Imprimir ao alcance do polegar');

  // A aba Prévia troca o conteúdo e a folha precisa caber na tela.
  await pagina.locator('.aba[data-aba="previa"]').click();
  await pagina.waitForTimeout(300);
  ok(!(await pagina.locator('.painel').isVisible()), 'na aba Prévia o painel de ajustes desaparece');
  const caixaFolha = await pagina.locator('.folha').first().boundingBox();
  ok(
    caixaFolha && caixaFolha.x >= -1 && caixaFolha.x + caixaFolha.width <= LARGURA + 1,
    'a folha cabe inteira na largura da tela',
    caixaFolha ? `x=${Math.round(caixaFolha.x)} w=${Math.round(caixaFolha.width)} de ${LARGURA}` : 'sem folha'
  );
  ok(await pagina.locator('.sheet').first().isVisible(), 'a folha é renderizada na prévia');
  await semTransbordo('estúdio de impressão (prévia)');
  await pagina.screenshot({ path: '/tmp/baralho_png/mobile-impressao.png', fullPage: false });

  await pagina.locator('.aba[data-aba="ajustes"]').click();
  await pagina.waitForTimeout(250);
  ok(await pagina.locator('.painel').isVisible(), 'volta para os ajustes');
  await alvosDeToque('.painel .btn', 44, 'botões do painel com alvo de toque adequado');
  await alvosDeToque('.chip', 40, 'chips de tema com alvo de toque adequado');
  ok(
    (await pagina.locator('#ajustar-tela').count()) === 1 && (await pagina.locator('#creditos') .count()) === 0,
    'controles de celular presentes (ajustar à tela)'
  );

  /* ----------------------------- tópicos ------------------------------ */
  await pagina.goto(BASE_URL + '/topicos.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lista-cartas .carta-linha');
  await semTransbordo('meus tópicos');

  await pagina.fill('#novo-nome', 'Trabalho e arte');
  await pagina.click('#criar-topico');
  await pagina.waitForTimeout(200);
  ok((await pagina.locator('#lista-topicos .topico-linha[data-proprio="1"]').count()) === 1, 'criar tópico funciona no celular');

  // Sem seleção, a barra fixa não aparece.
  ok(!(await pagina.locator('.grupo--aplicar').isVisible()), 'barra de atribuição escondida sem seleção');

  await pagina.check('#lista-cartas .carta-linha[data-card="C01"] input[type=checkbox]');
  await pagina.waitForTimeout(150);
  ok(await pagina.locator('.grupo--aplicar').isVisible(), 'barra de atribuição aparece ao selecionar uma carta');
  const posicao = await pagina.locator('.grupo--aplicar').evaluate((el) => getComputedStyle(el).position);
  ok(posicao === 'fixed', 'a barra de atribuição fica fixa no rodapé', posicao);

  const caixaBarra = await pagina.locator('.grupo--aplicar').boundingBox();
  const alturaJanela = devices['iPhone 13'].viewport.height;
  ok(
    caixaBarra && caixaBarra.y + caixaBarra.height <= alturaJanela + 1,
    'a barra de atribuição fica dentro da tela',
    caixaBarra ? `y=${Math.round(caixaBarra.y)} h=${Math.round(caixaBarra.height)} de ${alturaJanela}` : 'sem barra'
  );

  const chave = await pagina.locator('#lista-topicos .topico-linha[data-proprio="1"]').getAttribute('data-chave');
  await pagina.selectOption('#alvo-atribuicao', chave);
  await pagina.click('#aplicar');
  await pagina.waitForTimeout(200);
  const atribuido = await pagina.locator('#lista-cartas .carta-linha[data-card="C01"] select').inputValue();
  ok(atribuido === chave, 'atribuir pela barra fixa funciona no celular', atribuido);
  await pagina.screenshot({ path: '/tmp/baralho_png/mobile-topicos.png', fullPage: false });

  /* --------- regressão: imprimir da aba "Ajustes" não pode sair vazio -------- */
  await pagina.goto(BASE_URL + '/print.html', { waitUntil: 'networkidle' });
  // Na aba "Ajustes" a prévia está escondida: o elemento existe, mas não está visível.
  await pagina.waitForSelector('.sheet', { state: 'attached' });
  await pagina.locator('.aba[data-aba="ajustes"]').click();
  await pagina.waitForTimeout(200);
  await pagina.emulateMedia({ media: 'print' });
  const previaNaImpressao = await pagina.locator('.preview').evaluate(
    (el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().height > 0
  );
  ok(previaNaImpressao, 'com a aba "Ajustes" ativa, a prévia continua visível ao imprimir');
  const pdf = await pagina.pdf({ printBackground: true });
  const folhasNoPdf = (Buffer.from(pdf).toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  ok(folhasNoPdf >= 4, 'a impressão a partir de "Ajustes" gera as folhas', folhasNoPdf + ' página(s)');
  await pagina.emulateMedia({ media: 'screen' });

  /* ---------------- índice de fontes ---------------- */
  await pagina.goto(BASE_URL + '/fontes.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.fonte');
  await semTransbordo('índice de fontes');

  const dados = await (await fetch(BASE_URL + '/api/cards?draft=1')).json();
  const total = dados.cards.length;
  const comFonte = dados.cards.filter((c) => c.status !== 'reject' && c.link).length;
  const semFonte = dados.cards.filter((c) => c.status !== 'reject' && !c.link).length;
  const rejeitadas = dados.cards.filter((c) => c.status === 'reject').length;

  ok((await pagina.locator('.fonte').count()) === total,
     'o índice lista todas as cartas', `${await pagina.locator('.fonte').count()} de ${total}`);
  ok((await pagina.locator('.fonte--ok').count()) === comFonte, 'as cartas com fonte são marcadas', String(comFonte));
  ok((await pagina.locator('.fonte--sem').count()) === semFonte, 'as sem fonte são marcadas', String(semFonte));
  ok((await pagina.locator('.fonte--rejeitada').count()) === rejeitadas, 'as rejeitadas são marcadas', String(rejeitadas));
  ok((await pagina.locator('.fonte__link').count()) >= comFonte,
     'cada carta com fonte mostra o link');
  ok((await pagina.locator('.fonte__sem-fonte').count()) === semFonte,
     'cada carta sem fonte diz que não tem');

  // o link precisa ser link de verdade, com http(s)
  const hrefs = await pagina.$$eval('.fonte__link', (ns) => ns.map((n) => n.getAttribute('href')));
  ok(hrefs.length > 0 && hrefs.every((h) => /^https?:\/\//.test(h || '')), 'todos os links são http(s)');
  // Link repetido é legítimo: as 16 cartas de programa apontam para a mesma
  // página oficial. O que não pode faltar é o veículo identificado.
  const semVeiculo = dados.cards.filter((c) => c.link && !c.veiculo).map((c) => c.id);
  ok(semVeiculo.length === 0, 'toda carta com link diz de que veículo vem',
     semVeiculo.join(' '));
  ok(new Set(hrefs).size >= 4, 'há várias fontes distintas no índice', `${new Set(hrefs).size} distintas`);

  // os filtros recortam a lista
  await pagina.locator('.filtro', { hasText: 'sem fonte' }).click();
  await pagina.waitForTimeout(200);
  ok((await pagina.locator('.fonte').count()) === semFonte, 'o filtro "sem fonte" funciona');
  await pagina.locator('.filtro', { hasText: 'rejeitada' }).click();
  await pagina.waitForTimeout(200);
  ok((await pagina.locator('.fonte').count()) === rejeitadas, 'o filtro "rejeitada" funciona');
  await pagina.locator('.filtro', { hasText: 'todas' }).click();
  await pagina.waitForTimeout(200);
  ok((await pagina.locator('.fonte').count()) === total, 'o filtro "todas" volta ao total');
  await alvosDeToque('.filtro', 32, 'filtros com alvo de toque adequado');

  ok(erros.length === 0, 'nenhum erro de JavaScript nas páginas', erros.slice(0, 3).join(' | '));
} finally {
  await navegador.close();
}

console.log('\n=== verificação mobile (iPhone 13) ===');
console.log('  ' + passou + ' verificações passaram');
if (falhas.length) {
  console.log('  ' + falhas.length + ' FALHA(S):');
  for (const f of falhas) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log('  tudo certo ✓');
