/**
 * Índice de fontes: lista auditável de toda citação do baralho e do link que a
 * sustenta. Lê /api/cards?draft=1 (inclui rascunho e rejeitadas) e monta a lista.
 *
 * O link é o dado mais importante da página: cada linha mostra o endereço
 * completo, clicável, ou diz explicitamente que não há fonte anexada.
 */

const $ = (id) => document.getElementById(id);
const criar = (tag, classe, texto) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto != null) el.textContent = texto;
  return el;
};

let CARTAS = [];
let filtro = 'todas';

const SITUACAO = (c) => {
  if (c.status === 'reject') return 'rejeitada';
  return c.link ? 'com' : 'sem';
};

const ROTULO = { com: 'com fonte', sem: 'sem fonte', rejeitada: 'rejeitada' };

async function carregar() {
  const resposta = await fetch('/api/cards?draft=1', { cache: 'no-store' });
  if (!resposta.ok) throw new Error('GET /api/cards → ' + resposta.status);
  CARTAS = (await resposta.json()).cards || [];
  // a ordem do baralho é o número impresso na carta
  CARTAS.sort((a, b) => (a.numeroNaCarta ?? 0) - (b.numeroNaCarta ?? 0));
  const carregando = $('carregando');
  if (carregando) carregando.remove();
  montarFiltros();
  desenhar();
}

function contar() {
  const c = { todas: CARTAS.length, com: 0, sem: 0, rejeitada: 0 };
  for (const carta of CARTAS) c[SITUACAO(carta)]++;
  return c;
}

function montarFiltros() {
  const caixa = $('filtros');
  caixa.innerHTML = '';
  const n = contar();
  for (const chave of ['todas', 'com', 'sem', 'rejeitada']) {
    const b = criar('button', 'filtro');
    b.type = 'button';
    b.setAttribute('aria-pressed', filtro === chave ? 'true' : 'false');
    b.append(document.createTextNode((chave === 'todas' ? 'todas' : ROTULO[chave]) + ' '));
    b.append(criar('b', null, String(n[chave])));
    b.addEventListener('click', () => {
      filtro = chave;
      montarFiltros();
      desenhar();
    });
    caixa.append(b);
  }
}

function desenhar() {
  const lista = $('lista');
  lista.innerHTML = '';
  const visiveis = CARTAS.filter((c) => filtro === 'todas' || SITUACAO(c) === filtro);

  if (!visiveis.length) {
    lista.append(criar('li', 'vazio', 'nenhuma carta nesta situação.'));
    return;
  }

  for (const carta of visiveis) lista.append(linha(carta));

  const n = contar();
  $('resumo').textContent =
    `${n.todas} cartas · ${n.com} com fonte · ${n.sem} sem fonte · ${n.rejeitada} rejeitada`;
}

function linha(carta) {
  const situacao = SITUACAO(carta);
  const item = criar('li', 'fonte fonte--' + (situacao === 'com' ? 'ok' : situacao));

  const topo = criar('div', 'fonte__topo');
  topo.append(criar('span', 'fonte__numero', String(carta.numeroNaCarta ?? '')));
  topo.append(criar('span', 'fonte__autor', carta.autor || 'autoria não confirmada'));
  topo.append(criar('span', 'fonte__tema', '#' + carta.topic));
  topo.append(criar('span', 'fonte__situacao fonte__situacao--' + situacao, ROTULO[situacao]));
  item.append(topo);

  item.append(criar('blockquote', 'fonte__citacao', '“' + carta.quote + '”'));

  const rodape = criar('div', 'fonte__rodape');
  if (carta.link) {
    const a = document.createElement('a');
    a.className = 'fonte__link';
    a.href = carta.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = carta.link.replace(/^https?:\/\//, '');
    rodape.append(a);
  } else {
    rodape.append(criar('span', 'fonte__sem-fonte', 'sem fonte anexada'));
  }
  if (carta.veiculo) rodape.append(criar('span', 'fonte__veiculo', carta.veiculo));
  if (carta.data) rodape.append(criar('span', 'fonte__veiculo', String(carta.data)));
  item.append(rodape);

  if (carta.motivoRejeicao) {
    item.append(criar('p', 'fonte__motivo', 'Rejeitada: ' + carta.motivoRejeicao));
  }

  if (carta.observacao) {
    const obs = criar('p', 'fonte__obs', carta.observacao);
    obs.hidden = true;
    const botao = criar('button', 'fonte__ver-mais', 'ver observação');
    botao.type = 'button';
    botao.addEventListener('click', () => {
      obs.hidden = !obs.hidden;
      botao.textContent = obs.hidden ? 'ver observação' : 'esconder observação';
    });
    item.append(botao, obs);
  }

  return item;
}

/* ---------------------------------------------------------------- markdown */

function markdown() {
  const linhas = [
    '# Índice de fontes — Baralho',
    '',
    '| # | autor | citação | tema | situação | fonte |',
    '|---|---|---|---|---|---|',
  ];
  for (const c of CARTAS) {
    const situacao = SITUACAO(c);
    const citacao = '“' + String(c.quote).replace(/\|/g, '\\|') + '”';
    const fonte = c.link ? c.link : '**sem fonte anexada**';
    linhas.push(
      `| ${c.numeroNaCarta ?? ''} | ${c.autor || '—'} | ${citacao} | #${c.topic} | ${ROTULO[situacao]} | ${fonte} |`
    );
  }
  const n = contar();
  linhas.push('', `Total: ${n.todas} · com fonte: ${n.com} · sem fonte: ${n.sem} · rejeitada: ${n.rejeitada}`);
  return linhas.join('\n');
}

$('copiar').addEventListener('click', async () => {
  const recado = $('recado');
  try {
    await navigator.clipboard.writeText(markdown());
    recado.textContent = 'lista copiada';
  } catch {
    recado.textContent = 'não foi possível copiar — use o JSON';
  }
  recado.hidden = false;
  setTimeout(() => { recado.hidden = true; }, 2500);
});

carregar().catch((erro) => {
  $('carregando').textContent = 'não foi possível carregar: ' + erro.message;
});
