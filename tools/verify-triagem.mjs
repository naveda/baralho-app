#!/usr/bin/env node
/**
 * Verificação ponta a ponta do painel de triagem, com navegador de verdade.
 *
 * Não faz parte do app (que é zero-dep): precisa do Playwright.
 *
 *   mkdir -p /tmp/qrverify && cd /tmp/qrverify && npm i playwright-core
 *   node tools/verify-triagem.mjs /tmp/qrverify
 *
 * Sobe o próprio servidor com um arquivo de curadoria descartável — este teste
 * ESCREVE revisões, e não pode sujar a curadoria de verdade nem o seed.
 *
 * O que ele prova: que a regra dura vale também do lado da escrita (sem fonte
 * não aprova), que rejeitar exige motivo, que toda decisão fica com revisor e
 * data, e que aprovar faz a carta sair no bundle público.
 */
import { createRequire } from 'node:module';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.argv[2] || process.env.PLAYWRIGHT_DIR || '/tmp/qrverify';
const PORTA = Number(process.env.PORTA_TRIAGEM || 4185);
const BASE_URL = `http://127.0.0.1:${PORTA}`;
const CURADORIA = 'curadoria.verify.json';
const ARQUIVO_CURADORIA = join(APP, 'data', CURADORIA);

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

rmSync(ARQUIVO_CURADORIA, { force: true });

const servidor = spawn(process.execPath, [join(APP, 'web', 'server.mjs')], {
  env: {
    ...process.env,
    BARALHO_PORT: String(PORTA),
    BARALHO_HOST: '127.0.0.1',
    BARALHO_DATA: '',
    BARALHO_CURADORIA: CURADORIA,
  },
  stdio: 'ignore',
});

async function esperarServidor(tentativas = 60) {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(BASE_URL + '/api/health');
      if (r.ok) return true;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const navegador = await chromium.launch({ channel: 'chrome', headless: true });
const contexto = await navegador.newContext({ viewport: { width: 1200, height: 950 } });
const pagina = await contexto.newPage();

const erros = [];
pagina.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pagina.on('console', (m) => {
  if (m.type() === 'error') erros.push('console: ' + m.text());
});

try {
  ok(await esperarServidor(), 'o servidor de triagem sobe');

  const dados = await (await fetch(BASE_URL + '/api/cards?draft=1')).json();
  const total = dados.cards.length;
  const comFonte = dados.cards.filter((c) => c.link).length;
  const semFonte = dados.cards.filter((c) => !c.link).length;

  /* -------------------------------- painel -------------------------------- */
  await pagina.goto(BASE_URL + '/triagem.html', { waitUntil: 'networkidle' });
  await pagina.waitForSelector('.carta-triagem');

  ok((await pagina.locator('.carta-triagem').count()) === total,
    'o painel lista todas as cartas', `${await pagina.locator('.carta-triagem').count()} de ${total}`);
  const resumoInicial = (await pagina.textContent('#resumo')) || '';
  ok(resumoInicial.includes(String(total)), 'o resumo conta as cartas', resumoInicial);
  ok(resumoInicial.includes('0 aprovadas'), 'nada começa aprovado', resumoInicial);

  /* ------------------------------- revisor -------------------------------- */
  ok((await pagina.locator('.botao-acao:not(:disabled)').count()) === 0,
    'sem revisor identificado, nenhum botão age');
  await pagina.fill('#revisor', 'Revisora de Teste');
  await pagina.waitForTimeout(250);
  ok((await pagina.locator('.botao-acao:not(:disabled)').count()) > 0,
    'com revisor identificado, os botões agem');

  /* -------------------------- quem pode ser aprovado ---------------------- */
  const bloqueados = await pagina.$$eval('.botao-acao--aprovar:disabled', (ns) =>
    ns.map((n) => n.closest('.carta-triagem').dataset.id));
  const idsSemFonte = dados.cards.filter((c) => !c.link).map((c) => c.id);
  ok(bloqueados.length === semFonte, 'só as cartas sem fonte ficam bloqueadas para aprovar',
    `${bloqueados.length} de ${semFonte}`);
  ok(bloqueados.every((id) => idsSemFonte.includes(id)), 'e são exatamente elas', bloqueados.join(' '));
  ok((await pagina.locator('.triagem__explica').count()) === semFonte,
    'cada bloqueada explica por que não pode ser aprovada');

  await pagina.screenshot({ path: '/tmp/baralho_png/triagem-painel.png', fullPage: true });

  /* -------------------------------- aprovar ------------------------------- */
  const alvo = dados.cards.find((c) => c.link && c.status !== 'reject');
  await pagina.locator(`.carta-triagem[data-id="${alvo.id}"] .botao-acao--aprovar`).click();
  await pagina.waitForTimeout(900);
  const recado = (await pagina.textContent('#recado')) || '';
  ok(/aprovada/i.test(recado), 'aprovar dá retorno na tela', recado);

  const publico = await (await fetch(BASE_URL + '/api/cards')).json();
  ok(publico.cards.length === 1, 'a carta aprovada sai no bundle público', String(publico.cards.length));
  ok(publico.cards[0] && publico.cards[0].id === alvo.id, 'e é a carta certa', publico.cards[0]?.id);
  const revisao = publico.cards[0] && publico.cards[0].revisao;
  ok(revisao && revisao.revisor === 'Revisora de Teste', 'a revisão guarda quem aprovou');
  ok(revisao && Boolean(revisao.em), 'a revisão guarda quando');
  ok((await pagina.locator(`.carta-triagem[data-id="${alvo.id}"][data-status="approved"]`).count()) === 1,
    'o painel mostra a carta como aprovada');
  ok(((await pagina.textContent(`.carta-triagem[data-id="${alvo.id}"] .triagem__revisao`)) || '')
    .includes('Revisora de Teste'), 'a trilha da revisão aparece na carta');

  /* -------------------------------- rejeitar ------------------------------ */
  const semLink = dados.cards.find((c) => !c.link);
  await pagina.locator(`.carta-triagem[data-id="${semLink.id}"] .botao-acao--rejeitar`).click();
  await pagina.waitForTimeout(250);
  await pagina.locator(`.carta-triagem[data-id="${semLink.id}"] .motivo__confirmar`).click();
  await pagina.waitForTimeout(350);
  ok((await pagina.locator(`.carta-triagem[data-id="${semLink.id}"] .motivo`).count()) === 1,
    'rejeitar sem motivo não passa');

  await pagina.fill(`.carta-triagem[data-id="${semLink.id}"] .motivo`,
    'atribuição não localizada em nenhuma fonte');
  await pagina.locator(`.carta-triagem[data-id="${semLink.id}"] .motivo__confirmar`).click();
  await pagina.waitForTimeout(900);

  const depois = await (await fetch(BASE_URL + '/api/cards?draft=1')).json();
  const rejeitada = depois.cards.find((c) => c.id === semLink.id);
  ok(rejeitada.status === 'reject', 'rejeitar com motivo funciona', rejeitada.status);
  ok(String(rejeitada.motivoRejeicao).includes('atribuição não localizada'),
    'o motivo fica gravado na carta', String(rejeitada.motivoRejeicao));
  ok((await pagina.locator(`.carta-triagem[data-id="${semLink.id}"][data-status="reject"]`).count()) === 1,
    'o painel mostra a carta como rejeitada');

  /* ------------------------------ persistência ---------------------------- */
  const gravado = JSON.parse(readFileSync(ARQUIVO_CURADORIA, 'utf8'));
  ok(Boolean(gravado.revisoes[alvo.id]), 'a revisão foi gravada em arquivo');
  ok(gravado.revisoes[alvo.id].revisor === 'Revisora de Teste', 'o arquivo guarda o revisor');
  ok(Boolean(gravado.revisoes[alvo.id].em), 'o arquivo guarda a data');

  const seed = JSON.parse(readFileSync(join(APP, 'data', 'cards.seed.json'), 'utf8'));
  ok(seed.cards.find((c) => c.id === alvo.id).status === 'wait',
    'o arquivo de pesquisa continua intocado');

  // recarregar a página mantém o estado (não é só memória da tela)
  await pagina.reload({ waitUntil: 'networkidle' });
  await pagina.waitForSelector('.carta-triagem');
  ok((await pagina.locator(`.carta-triagem[data-id="${alvo.id}"][data-status="approved"]`).count()) === 1,
    'recarregar o painel mantém a decisão');

  /* -------------------------------- filtros ------------------------------- */
  await pagina.locator('.filtro', { hasText: 'aprovadas' }).click();
  await pagina.waitForTimeout(250);
  ok((await pagina.locator('.carta-triagem').count()) === 1, 'o filtro "aprovadas" recorta a lista');
  await pagina.locator('.filtro', { hasText: 'sem fonte' }).click();
  await pagina.waitForTimeout(250);
  const semFonteRestantes = dados.cards.filter((c) => !c.link && c.id !== semLink.id).length;
  ok((await pagina.locator('.carta-triagem').count()) === semFonteRestantes,
    'o filtro "sem fonte" recorta a lista', String(semFonteRestantes));
  await pagina.locator('.filtro', { hasText: 'todas' }).click();
  await pagina.waitForTimeout(250);
  ok((await pagina.locator('.carta-triagem').count()) === total, 'o filtro "todas" volta ao total');

  /* -------------------------------- celular ------------------------------- */
  const contextoMobile = await navegador.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
  });
  const m = await contextoMobile.newPage();
  m.on('pageerror', (e) => erros.push('pageerror(mobile): ' + e.message));
  await m.goto(BASE_URL + '/triagem.html', { waitUntil: 'networkidle' });
  await m.waitForSelector('.carta-triagem');
  const transbordo = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(transbordo <= 1, 'o painel não rola na horizontal no celular', `transbordo de ${transbordo}px`);
  await m.fill('#revisor', 'Revisora de Teste');
  await m.waitForTimeout(250);
  const alvos = await m.$$eval('.filtro, .botao-acao', (ns) =>
    ns.filter((n) => n.offsetParent !== null).map((n) => Math.round(n.getBoundingClientRect().height)));
  ok(alvos.every((h) => h >= 32), 'botões e filtros têm alvo de toque adequado', JSON.stringify(alvos));
  await m.screenshot({ path: '/tmp/baralho_png/triagem-celular.png', fullPage: true });
  await contextoMobile.close();

  ok(erros.length === 0, 'nenhum erro de JavaScript', erros.slice(0, 3).join(' | '));
} finally {
  await navegador.close();
  servidor.kill('SIGTERM');
  rmSync(ARQUIVO_CURADORIA, { force: true });
  rmSync(ARQUIVO_CURADORIA + '.tmp', { force: true });
}

console.log('\n=== verificação do painel de triagem ===');
console.log(`  ${passou} verificações passaram`);
if (falhas.length) {
  console.log(`  ${falhas.length} FALHA(S):`);
  for (const f of falhas) console.log('   ✗ ' + f);
  process.exit(1);
}
console.log('  tudo certo ✓');
