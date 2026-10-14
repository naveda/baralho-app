#!/usr/bin/env node
/**
 * Gera a versão estática do app para publicação no GitHub Pages (zero dependências).
 *
 *   node tools/build-pages.mjs [pasta_destino]
 *
 * Padrão de destino: `_site` (ou pasta especificada).
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.argv[2] ? resolve(process.argv[2]) : join(APP, '_site');

async function main() {
  console.log(`Gerando site estático em ${OUT}...`);
  await mkdir(OUT, { recursive: true });

  // 1. Copia arquivos públicos da web
  await cp(join(APP, 'web', 'public'), OUT, { recursive: true });

  // 2. Copia a biblioteca de módulos ESM compartilhados (qr, deck, jogo, topics, store)
  await cp(join(APP, 'lib'), join(OUT, 'lib'), { recursive: true });

  // 3. Copia a pasta de dados
  await cp(join(APP, 'data'), join(OUT, 'data'), { recursive: true });

  // 4. Cria os endpoints de API estáticos (cards, topics, curadoria)
  const apiDir = join(OUT, 'api');
  await mkdir(apiDir, { recursive: true });

  const seed = await readFile(join(APP, 'data', 'cards.seed.json'), 'utf8');
  await writeFile(join(apiDir, 'cards'), seed);
  await writeFile(join(apiDir, 'cards.json'), seed);

  const topics = await readFile(join(APP, 'data', 'topics.json'), 'utf8');
  await writeFile(join(apiDir, 'topics'), topics);
  await writeFile(join(apiDir, 'topics.json'), topics);

  const csv = await readFile(join(APP, 'data', 'cards.csv'), 'utf8');
  await writeFile(join(apiDir, 'cards.csv'), csv);

  try {
    const curadoria = await readFile(join(APP, 'data', 'curadoria.json'), 'utf8');
    await writeFile(join(apiDir, 'curadoria'), curadoria);
    await writeFile(join(apiDir, 'curadoria.json'), curadoria);
  } catch (_) {
    await writeFile(join(apiDir, 'curadoria'), JSON.stringify({ schemaVersion: 1, revisoes: {} }));
    await writeFile(join(apiDir, 'curadoria.json'), JSON.stringify({ schemaVersion: 1, revisoes: {} }));
  }

  // 5. Adiciona .nojekyll para o GitHub Pages não ignorar pastas/arquivos com sublinhado ou dotfiles
  await writeFile(join(OUT, '.nojekyll'), '');

  console.log('Site estático pronto com sucesso em ' + OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
