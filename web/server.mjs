#!/usr/bin/env node
/**
 * Servidor estático do baralho — `node:http`, zero dependências.
 *
 * Rotas:
 *   GET /                → web/public/index.html
 *   GET /print.html      → estúdio de impressão
 *   GET /lib/*           → módulos ESM compartilhados (qr.mjs, deck.mjs)
 *   GET /api/cards       → cartas (só `approved`; `?draft=1` inclui wait/reject)
 *   GET /api/cards.csv   → a planilha de cartas (a fonte), para download
 *   GET /api/curadoria   → revisão registrada de cada carta
 *   POST /api/curadoria  → registra uma revisão (aprovar / esperar / rejeitar)
 *   GET /api/topics      → taxonomia de temas
 *   GET /api/health      → estado do conjunto de dados
 *   GET /*               → arquivos de web/public
 *
 * A regra dura vale aqui: sem `draft=1`, nada com status `wait`/`reject` sai do
 * servidor. É o que impede uma carta não verificada de chegar ao público.
 */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, resolve, dirname, extname, normalize, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = existsSync(join(SCRIPT_DIR, '..', 'data'))
  ? resolve(SCRIPT_DIR, '..')
  : SCRIPT_DIR;
const PUBLIC_DIR = existsSync(join(APP_DIR, 'web', 'public')) ? join(APP_DIR, 'web', 'public') : APP_DIR;
const LIB_DIR = join(APP_DIR, 'lib');
const DATA_DIR = join(APP_DIR, 'data');

const PORT = Number(process.env.BARALHO_PORT || 4178);
const HOST = process.env.BARALHO_HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const json = (res, code, body) => {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(code, {
    'content-type': MIME['.json'],
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
};

/**
 * Lê o conjunto de cartas.
 * Ordem: `BARALHO_DATA` (nome do arquivo em data/, útil para fixtures e testes) →
 * `cards.json` (curado) → `cards.seed.json` (pesquisa).
 */
async function loadCards() {
  const forcado = process.env.BARALHO_DATA ? basename(process.env.BARALHO_DATA) : null;
  const fontes = forcado
    ? [[forcado, 'forcado']]
    : [
        ['cards.json', 'curado'],
        ['cards.seed.json', 'seed'],
      ];
  for (const [file, origem] of fontes) {
    try {
      const raw = await readFile(join(DATA_DIR, file), 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.cards)) return { cards: parsed.cards, origem, arquivo: file };
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return { cards: [], origem: 'vazio', arquivo: null };
}

/**
 * Curadoria: a revisão vive em arquivo separado do conjunto de pesquisa, então
 * o seed nunca é reescrito. Cada decisão guarda revisor, data e motivo.
 */
const CURADORIA_FILE = join(
  DATA_DIR,
  basename(process.env.BARALHO_CURADORIA || 'curadoria.json')
);

async function loadCuradoria() {
  try {
    const raw = await readFile(CURADORIA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const revisoes = parsed && parsed.revisoes;
    return revisoes && typeof revisoes === 'object' ? revisoes : {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

/** Sobrepõe a revisão às cartas. Sem revisão, a carta fica como veio da pesquisa. */
function aplicarCuradoria(cards, revisoes) {
  return cards.map((c) => {
    const r = revisoes[c.id];
    if (!r) return c;
    const carta = {
      ...c,
      status: r.status,
      revisao: { revisor: r.revisor, em: r.em, motivo: r.motivo || null },
    };
    if (r.status === 'reject') carta.motivoRejeicao = r.motivo || 'sem motivo registrado';
    return carta;
  });
}

async function salvarCuradoria(revisoes) {
  const conteudo = JSON.stringify(
    {
      schemaVersion: 1,
      nota: 'Revisão das cartas, separada do arquivo de pesquisa. O seed nunca é reescrito.',
      atualizadoEm: new Date().toISOString(),
      revisoes,
    },
    null,
    2
  ) + '\n';
  // Troca atômica: grava num temporário e renomeia.
  const temporario = CURADORIA_FILE + '.tmp';
  await writeFile(temporario, conteudo, 'utf8');
  await rename(temporario, CURADORIA_FILE);
}

function lerCorpo(req, limite = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const partes = [];
    req.on('data', (pedaco) => {
      total += pedaco.length;
      if (total > limite) {
        reject(Object.assign(new Error('corpo grande demais'), { status: 413 }));
        req.destroy();
        return;
      }
      partes.push(pedaco);
    });
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

async function loadTopics() {
  const raw = await readFile(join(DATA_DIR, 'topics.json'), 'utf8');
  return JSON.parse(raw);
}

async function loadCreditos() {
  const raw = await readFile(join(DATA_DIR, 'creditos.json'), 'utf8');
  return JSON.parse(raw);
}

async function serveStatic(res, baseDir, relPath) {
  // Sem travessia de caminho: resolve e confere se continua dentro da base.
  const target = resolve(baseDir, '.' + sep + normalize(relPath).replace(/^(\.\.[/\\])+/, ''));
  if (target !== baseDir && !target.startsWith(baseDir + sep)) {
    res.writeHead(403).end('403');
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw Object.assign(new Error('não é arquivo'), { code: 'ENOENT' });
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404 — não encontrado');
    } else {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 — ' + err.message);
    }
  }
}

/**
 * Registra uma revisão. As regras são as do produto:
 *  - só carta que existe no conjunto pode ser revisada;
 *  - aprovar exige fonte anexada (é a regra dura: sem fonte, não circula);
 *  - rejeitar exige motivo (a decisão precisa ser auditável);
 *  - toda revisão guarda nome do revisor e data.
 */
async function registrarRevisao(req, res) {
  let pedido;
  try {
    pedido = JSON.parse(await lerCorpo(req));
  } catch (err) {
    return json(res, err.status || 400, { erro: 'corpo inválido: ' + err.message });
  }

  const { id, status, revisor, motivo } = pedido || {};
  if (!id || typeof id !== 'string') return json(res, 400, { erro: 'falta o id da carta' });
  if (!['approved', 'wait', 'reject'].includes(status)) {
    return json(res, 400, { erro: 'status precisa ser approved, wait ou reject' });
  }
  if (!revisor || typeof revisor !== 'string' || revisor.trim().length < 3) {
    return json(res, 400, { erro: 'toda revisão precisa de um revisor identificado' });
  }
  if (status === 'reject' && (!motivo || String(motivo).trim().length < 5)) {
    return json(res, 400, { erro: 'rejeitar exige motivo' });
  }

  const { cards } = await loadCards();
  const carta = cards.find((c) => c.id === id);
  if (!carta) return json(res, 404, { erro: 'carta não encontrada: ' + id });
  if (status === 'approved' && !carta.link) {
    return json(res, 409, {
      erro: 'sem fonte anexada, a carta não pode ser aprovada',
      detalhe: 'as regras do baralho não deixam circular acusação sem fonte',
    });
  }

  const revisoes = await loadCuradoria();
  const revisao = {
    status,
    revisor: revisor.trim(),
    em: new Date().toISOString(),
    motivo: status === 'reject' ? String(motivo).trim() : null,
  };
  revisoes[id] = revisao;
  await salvarCuradoria(revisoes);
  return json(res, 200, { ok: true, id, revisao });
}

const SOLICITACOES_FILE = join(
  DATA_DIR,
  basename(process.env.BARALHO_SOLICITACOES || 'solicitacoes.json')
);

async function loadSolicitacoes() {
  try {
    const raw = await readFile(SOLICITACOES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.solicitacoes) ? parsed.solicitacoes : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function salvarSolicitacoes(solicitacoes) {
  const conteudo = JSON.stringify(
    {
      schemaVersion: 1,
      atualizadoEm: new Date().toISOString(),
      solicitacoes,
    },
    null,
    2
  ) + '\n';
  const temporario = SOLICITACOES_FILE + '.tmp';
  await writeFile(temporario, conteudo, 'utf8');
  await rename(temporario, SOLICITACOES_FILE);
}

async function registrarSolicitacaoCodigo(req, res) {
  let pedido;
  try {
    pedido = JSON.parse(await lerCorpo(req));
  } catch (err) {
    return json(res, err.status || 400, { erro: 'corpo inválido: ' + err.message });
  }

  const { nome, redeSocial, telefone, mensagem } = pedido || {};
  if (!nome || typeof nome !== 'string' || nome.trim().length < 2) {
    return json(res, 400, { erro: 'Nome é obrigatório (ao menos 2 caracteres).' });
  }
  if (!redeSocial || typeof redeSocial !== 'string' || redeSocial.trim().length < 2) {
    return json(res, 400, { erro: 'Perfil de rede social é obrigatório.' });
  }
  if (!telefone || typeof telefone !== 'string' || telefone.trim().length < 8) {
    return json(res, 400, { erro: 'Telefone com DDD é obrigatório.' });
  }

  const solicitacoes = await loadSolicitacoes();
  const nova = {
    id: 'sol-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    em: new Date().toISOString(),
    nome: nome.trim(),
    redeSocial: redeSocial.trim(),
    telefone: telefone.trim(),
    mensagem: mensagem && typeof mensagem === 'string' ? mensagem.trim() : '',
    status: 'pendente',
  };

  solicitacoes.unshift(nova);
  await salvarSolicitacoes(solicitacoes);
  return json(res, 201, { ok: true, id: nova.id, mensagem: 'Solicitação registrada com sucesso.' });
}

const server = createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || HOST}`);
  } catch {
    res.writeHead(400).end('400');
    return;
  }
  const path = decodeURIComponent(url.pathname);
  const somenteLeitura = req.method === 'GET' || req.method === 'HEAD';
  const postPermitido = req.method === 'POST' && (path === '/api/curadoria' || path === '/api/solicitar-codigo');
  if (!somenteLeitura && !postPermitido) {
    res.writeHead(405, { allow: 'GET, HEAD, POST /api/curadoria, POST /api/solicitar-codigo' }).end('405');
    return;
  }

  try {
    if (path === '/api/cards.csv') {
      // A planilha é a fonte das cartas: o app a serve, para quem quiser editar.
      const conteudo = await readFile(join(DATA_DIR, 'cards.csv'));
      res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="cards.csv"',
        'content-length': conteudo.length,
        'cache-control': 'no-store',
      });
      return res.end(conteudo);
    }

    if (path === '/api/curadoria' && req.method === 'GET') {
      const revisoes = await loadCuradoria();
      return json(res, 200, { total: Object.keys(revisoes).length, revisoes });
    }

    if (path === '/api/curadoria' && req.method === 'POST') {
      return await registrarRevisao(req, res);
    }

    if (path === '/api/solicitar-codigo' && req.method === 'POST') {
      return await registrarSolicitacaoCodigo(req, res);
    }

    if (path === '/api/solicitar-codigo' && req.method === 'GET') {
      const solicitacoes = await loadSolicitacoes();
      return json(res, 200, { total: solicitacoes.length, solicitacoes });
    }

    if (path === '/api/health') {
      const { cards: cruas, origem, arquivo } = await loadCards();
      const cards = aplicarCuradoria(cruas, await loadCuradoria());
      const porStatus = { approved: 0, wait: 0, reject: 0 };
      for (const c of cards) if (porStatus[c.status] !== undefined) porStatus[c.status]++;
      return json(res, 200, { ok: true, origem, arquivo, total: cards.length, porStatus, porta: PORT });
    }

    if (path === '/api/cards') {
      const draft = url.searchParams.get('draft') === '1';
      const { cards: cruas, origem, arquivo } = await loadCards();
      const cards = aplicarCuradoria(cruas, await loadCuradoria());
      const visiveis = draft ? cards : cards.filter((c) => c.status === 'approved');
      return json(res, 200, {
        origem,
        arquivo,
        modoRascunho: draft,
        total: visiveis.length,
        omitidas: cards.length - visiveis.length,
        cards: visiveis,
      });
    }

    if (path === '/api/topics') {
      return json(res, 200, await loadTopics());
    }

    if (path === '/api/creditos') {
      return json(res, 200, await loadCreditos());
    }

    if (path.startsWith('/lib/')) {
      return serveStatic(res, LIB_DIR, path.slice('/lib/'.length));
    }

    if (path === '/' || path === '') {
      return serveStatic(res, PUBLIC_DIR, 'index.html');
    }

    return serveStatic(res, PUBLIC_DIR, path.replace(/^\/+/, ''));
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('500 — ' + err.message);
  }
});

server.listen(PORT, HOST, async () => {
  const { cards, origem, arquivo } = await loadCards().catch(() => ({ cards: [], origem: 'erro', arquivo: null }));
  const aprovadas = cards.filter((c) => c.status === 'approved').length;
  console.log(`baralho-app em http://${HOST}:${PORT}`);
  console.log(`  estúdio de impressão: http://${HOST}:${PORT}/print.html`);
  console.log(`  dados: ${arquivo || 'nenhum'} (${origem}) — ${cards.length} cartas, ${aprovadas} aprovadas`);
  if (!aprovadas) {
    console.log('  aviso: nenhuma carta aprovada; a impressão exige modo rascunho (tarja NÃO VERIFICADO).');
  }
});
