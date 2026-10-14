#!/usr/bin/env node
/**
 * Verificação ponta a ponta do editor de tópicos, com navegador de verdade.
 *
 * Não faz parte do app (que é zero-dep): precisa do Playwright.
 *
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core
 *   node baralho-app/web/server.mjs &
 *   node baralho-app/tools/verify-topicos.mjs /tmp/qrverify
 *
 * Percorre o fluxo que o usuário pediu: criar um tópico próprio, renomear um
 * tema da taxonomia, atribuir cartas em massa e conferir que o estúdio de
 * impressão passa a filtrar e a imprimir com o tópico novo — inclusive a
 * etiqueta `#` da frente e o nome no verso.
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
const { chromium } = require('playwright-core');

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
const contexto = await navegador.newContext({ viewport: { width: 1500, height: 950 } });
const pagina = await contexto.newPage();

const erros = [];
pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push('console: ' + m.text());
});

try {
  /* ------------------------------ editor ------------------------------ */
  await pagina.goto(BASE_URL + '/topicos.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('#lista-topicos .topico-linha');
  const topicosIniciais = await pagina.locator('#lista-topicos .topico-linha').count();
  ok(topicosIniciais === 16, 'taxonomia base carregou com 16 temas', 'veio ' + topicosIniciais);

  await pagina.fill('#novo-nome', 'Arte e educação');
  const previa = await pagina.textContent('#previa-slug');
  ok(/arte-e-educacao/.test(previa), 'prévia da etiqueta derivada do nome', previa);
  await pagina.click('#criar-topico');
  await pagina.waitForTimeout(150);

  const topicosDepois = await pagina.locator('#lista-topicos .topico-linha').count();
  ok(topicosDepois === 17, 'tópico próprio criado', 'veio ' + topicosDepois);
  const linhaNova = pagina.locator('#lista-topicos .topico-linha[data-proprio="1"]');
  ok((await linhaNova.count()) === 1, 'linha marcada como tópico próprio');
  ok((await linhaNova.locator('input').nth(0).inputValue()) === 'Arte e educação', 'nome do tópico próprio gravado');
  ok((await linhaNova.locator('input').nth(1).inputValue()) === 'arte-e-educacao', 'etiqueta # do tópico próprio');

  const linhaBase = pagina.locator('#lista-topicos .topico-linha[data-chave="economia"]');
  await linhaBase.locator('input').nth(0).fill('Dinheiro do povo');
  await linhaBase.locator('input').nth(0).blur();
  await pagina.waitForTimeout(150);
  ok(
    (await pagina.locator('#filtro-topico option', { hasText: 'Dinheiro do povo' }).count()) >= 1,
    'tema da base renomeado aparece no filtro'
  );

  const ids = ['C01', 'C02', 'C16'];
  for (const id of ids) await pagina.check('#lista-cartas .carta-linha[data-card="' + id + '"] input[type=checkbox]');
  ok((await pagina.textContent('#contagem-selecionadas')).includes('3 carta'), 'três cartas selecionadas');
  const chavePropria = await linhaNova.getAttribute('data-chave');
  await pagina.selectOption('#alvo-atribuicao', chavePropria);
  await pagina.click('#aplicar');
  await pagina.waitForTimeout(200);
  const valores = [];
  for (const id of ids) {
    valores.push(await pagina.locator('#lista-cartas .carta-linha[data-card="' + id + '"] select').inputValue());
  }
  ok(valores.every((v) => v === chavePropria), 'as três cartas apontam para o tópico próprio', valores.join(','));

  const guardado = await pagina.evaluate(() => localStorage.getItem('baralho.topicos.v1'));
  ok(Boolean(guardado) && JSON.parse(guardado).proprios.length === 1, 'overlay gravado no localStorage');

  /* ----------------------------- impressão ---------------------------- */
  await pagina.goto(BASE_URL + '/print.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('#temas .chip');
  const chips = await pagina.locator('#temas .chip').allTextContents();
  ok(chips.some((c) => c.includes('Arte e educação')), 'chip do tópico próprio no estúdio de impressão');
  ok(chips.some((c) => c.includes('Dinheiro do povo')), 'chip do tema renomeado no estúdio de impressão');
  ok(!chips.some((c) => c.includes('Economia')), 'o nome antigo do tema não aparece mais');
  ok((await pagina.locator('#temas .chip--proprio').count()) === 1, 'chip próprio tem marcação visual');

  const chipArte = pagina.locator('#temas .chip', { hasText: 'Arte e educação' });
  await chipArte.click();
  await pagina.waitForTimeout(250);
  const etiquetas = await pagina.locator('.card--front .card__tema').allTextContents();
  ok(etiquetas.length > 0, 'há cartas impressas no tópico próprio', String(etiquetas.length));
  ok(etiquetas.every((e) => e === '#arte-e-educacao'), 'a etiqueta # da carta usa o tópico próprio', [...new Set(etiquetas)].join(','));
  const numeros = await pagina.locator('.card--front .card__rank').allTextContents();
  ok(
    ['1', '2', '16'].every((n) => numeros.includes(n)) && numeros.length === 6,
    'só as três cartas atribuídas foram impressas',
    numeros.join(',')
  );

  await chipArte.click();
  await pagina.locator('#temas .chip', { hasText: 'Dinheiro do povo' }).click();
  await pagina.waitForTimeout(250);
  const etiquetasEconomia = await pagina.locator('.card--front .card__tema').allTextContents();
  ok(
    etiquetasEconomia.every((e) => e === '#economia'),
    'tema renomeado mantém a etiqueta #economia (o identificador é estável)'
  );
  const rotuloVerso = await pagina.locator('.card--back .card__tags').first().textContent();
  ok(rotuloVerso.includes('Dinheiro do povo'), 'o verso mostra o nome renomeado', rotuloVerso);

  ok(erros.length === 0, 'nenhum erro de JavaScript nas duas páginas', erros.slice(0, 3).join(' | '));
} finally {
  await navegador.close();
}

console.log('\n=== verificação do editor de tópicos (navegador) ===');
console.log('  ' + passou + ' verificações passaram');
if (falhas.length) {
  console.log('  ' + falhas.length + ' FALHA(S):');
  for (const f of falhas) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log('  tudo certo ✓');
