#!/usr/bin/env node
/**
 * Publica o Baralho no VPS com as permissões corretas para o Nginx.
 *
 * Uso:
 *   node tools/deploy-vps.mjs
 */
import { execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

console.log('1. Gerando versão estática em _site/...');
execSync('node tools/build-pages.mjs', { cwd: APP, stdio: 'inherit' });

console.log('2. Sincronizando com o VPS (/var/www/baralho) com permissões www-data...');
execSync(
  'rsync -avz --delete --chmod=D755,F644 _site/ root@62.171.191.28:/var/www/baralho/',
  { cwd: APP, stdio: 'inherit' }
);

execSync(
  'ssh root@62.171.191.28 "chown -R www-data:www-data /var/www/baralho && chmod -R u=rwX,go=rX /var/www/baralho"',
  { cwd: APP, stdio: 'inherit' }
);

console.log('3. Testando resposta HTTP...');
const status = execSync('curl -sI https://baralho.62-171-191-28.sslip.io | head -n 1', {
  encoding: 'utf8',
});
console.log('Resposta:', status.trim());
console.log('✓ Publicação concluída com sucesso!');
