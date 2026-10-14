/**
 * Painel de triagem: é aqui que uma carta passa a `approved` e entra no bundle
 * público. Fala com GET/POST /api/curadoria.
 *
 * Regras que a tela respeita (e o servidor também, porque as duas pontas
 * precisam concordar):
 *   - só carta com fonte anexada pode ser aprovada;
 *   - rejeitar exige motivo;
 *   - toda decisão exige um revisor identificado.
 */

const $ = (id) => document.getElementById(id);
const criar = (tag, classe, texto) => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto != null) el.textContent = texto;
  return el;
};

const CHAVE_REVISOR = 'baralho.revisor.v1';
const ROTULO = { approved: 'aprovada', wait: 'em espera', reject: 'rejeitada' };

let CARTAS = [];
let REVISOES = {};
let filtro = 'todas';

const temFonte = (c) => Boolean(c.link);

async function carregar() {
  const [resCartas, resRevisoes] = await Promise.all([
    fetch('/api/cards?draft=1', { cache: 'no-store' }),
    fetch('/api/curadoria', { cache: 'no-store' }),
  ]);
  if (!resCartas.ok) throw new Error('GET /api/cards → ' + resCartas.status);

  const dados = await resCartas.json();
  CARTAS = (dados.cards || []).sort((a, b) => (a.numeroNaCarta ?? 0) - (b.numeroNaCarta ?? 0));
  if (resRevisoes.ok) REVISOES = (await resRevisoes.json()).revisoes || {};

  const guardado = localStorage.getItem(CHAVE_REVISOR) || '';
  if (guardado) $('revisor').value = guardado;
  $('revisor').addEventListener('input', atualizarRevisor);
  atualizarRevisor();

  const carregando = $('carregando');
  if (carregando) carregando.remove();

  montarFiltros();
  desenhar();
}

function revisor() { return $('revisor').value.trim(); }

function atualizarRevisor() {
  const nome = revisor();
  const pronto = nome.length >= 3;
  $('revisor').closest('.revisor').classList.toggle('revisor--pronto', pronto);
  $('revisor-aviso').textContent = pronto
    ? 'Assinando como ' + nome + '.'
    : 'O nome é gravado em cada decisão. Sem ele, os botões não agem.';
  if (nome) localStorage.setItem(CHAVE_REVISOR, nome);
  for (const b of document.querySelectorAll('.botao-acao')) b.disabled = !pronto || b.dataset.bloqueado === '1';
}

/* ------------------------------------------------------------ filtros */

function contar() {
  const n = { todas: CARTAS.length, approved: 0, wait: 0, reject: 0, semFonte: 0 };
  for (const c of CARTAS) {
    n[c.status] = (n[c.status] || 0) + 1;
    if (!temFonte(c) && c.status !== 'reject') n.semFonte++;
  }
  return n;
}

function montarFiltros() {
  const caixa = $('filtros');
  caixa.innerHTML = '';
  const n = contar();
  const opcoes = [
    ['todas', 'todas', n.todas],
    ['approved', 'aprovadas', n.approved],
    ['wait', 'em espera', n.wait],
    ['reject', 'rejeitadas', n.reject],
    ['semFonte', 'sem fonte', n.semFonte],
  ];
  for (const [chave, rotulo, total] of opcoes) {
    const b = criar('button', 'filtro');
    b.type = 'button';
    b.setAttribute('aria-pressed', filtro === chave ? 'true' : 'false');
    b.append(document.createTextNode(rotulo + ' '));
    b.append(criar('b', null, String(total)));
    b.addEventListener('click', () => { filtro = chave; montarFiltros(); desenhar(); });
    caixa.append(b);
  }
}

function desenhar() {
  const lista = $('lista');
  lista.innerHTML = '';
  const visiveis = CARTAS.filter((c) => {
    if (filtro === 'todas') return true;
    if (filtro === 'semFonte') return !temFonte(c) && c.status !== 'reject';
    return c.status === filtro;
  });

  if (!visiveis.length) {
    lista.append(criar('li', 'vazio', 'nenhuma carta nesta situação.'));
  } else {
    for (const carta of visiveis) lista.append(linha(carta));
  }

  const n = contar();
  $('resumo').textContent =
    `${n.todas} cartas · ${n.approved} aprovadas · ${n.wait} em espera · ${n.reject} rejeitadas`;
  atualizarRevisor();
}

/* -------------------------------------------------------------- linha */

function linha(carta) {
  const item = criar('li', 'carta-triagem');
  item.dataset.status = carta.status;
  item.dataset.id = carta.id;

  const topo = criar('div', 'triagem__topo');
  topo.append(criar('span', 'triagem__numero', String(carta.numeroNaCarta ?? '')));
  topo.append(criar('span', 'triagem__autor', carta.autor || 'autoria não confirmada'));
  topo.append(criar('span', 'triagem__tema', '#' + carta.topic));
  const selo = criar('span', 'triagem__selo', ROTULO[carta.status] || carta.status);
  selo.dataset.s = carta.status;
  topo.append(selo);
  item.append(topo);

  item.append(criar('blockquote', 'triagem__citacao', '“' + carta.quote + '”'));

  const fonte = criar('div', 'triagem__fonte');
  if (carta.link) {
    const a = document.createElement('a');
    a.href = carta.link;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = carta.link.replace(/^https?:\/\//, '');
    fonte.append(a);
  } else {
    fonte.append(criar('span', 'triagem__sem-fonte', 'sem fonte anexada'));
  }
  if (carta.veiculo) fonte.append(document.createTextNode(' · ' + carta.veiculo));
  item.append(fonte);

  if (carta.observacao) item.append(criar('p', 'triagem__obs', carta.observacao));
  if (carta.motivoRejeicao) item.append(criar('p', 'triagem__obs', 'Motivo da rejeição: ' + carta.motivoRejeicao));

  const revisao = REVISOES[carta.id];
  if (revisao) {
    const quando = new Date(revisao.em);
    const texto = criar('p', 'triagem__revisao');
    texto.append(document.createTextNode('Revisada por '));
    texto.append(criar('b', null, revisao.revisor));
    texto.append(document.createTextNode(
      ' em ' + quando.toLocaleString('pt-BR') + ' — ' + (ROTULO[revisao.status] || revisao.status) +
      (revisao.motivo ? ': ' + revisao.motivo : '')
    ));
    item.append(texto);
  }

  item.append(acoes(carta));
  return item;
}

function acoes(carta) {
  const caixa = criar('div', 'triagem__acoes');

  const botao = (rotulo, status, classe) => {
    const b = criar('button', 'botao-acao ' + classe, rotulo);
    b.type = 'button';
    b.dataset.status = status;
    if (carta.status === status) b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      if (status === 'reject') return pedirMotivo(caixa, carta, b);
      enviar(carta, status, null);
    });
    return b;
  };

  const aprovar = botao('Aprovar', 'approved', 'botao-acao--aprovar');
  if (!temFonte(carta)) {
    aprovar.disabled = true;
    aprovar.dataset.bloqueado = '1';
    aprovar.title = 'Sem fonte anexada, a carta não pode ser aprovada';
  }
  caixa.append(aprovar, botao('Em espera', 'wait', 'botao-acao--espera'), botao('Rejeitar', 'reject', 'botao-acao--rejeitar'));

  if (!temFonte(carta)) {
    caixa.append(criar('p', 'triagem__explica',
      'Aprovar está bloqueado: sem fonte anexada, a carta não circula.'));
  }
  return caixa;
}

/** Rejeitar exige motivo: abre o campo e só então envia. */
function pedirMotivo(caixa, carta, botaoRejeitar) {
  if (caixa.querySelector('.motivo')) {
    caixa.querySelector('.motivo').focus();
    return;
  }
  const campo = criar('input', 'motivo');
  campo.type = 'text';
  campo.placeholder = 'motivo da rejeição (obrigatório)';
  campo.maxLength = 300;
  const confirmar = criar('button', 'botao-acao botao-acao--rejeitar motivo__confirmar', 'Confirmar rejeição');
  confirmar.type = 'button';
  confirmar.addEventListener('click', () => {
    const motivo = campo.value.trim();
    if (motivo.length < 5) {
      campo.focus();
      campo.classList.add('motivo--falta');
      campo.placeholder = 'escreva o motivo (mínimo 5 letras)';
      return;
    }
    enviar(carta, 'reject', motivo);
  });
  caixa.append(campo, confirmar);
  campo.focus();
}

/* --------------------------------------------------------------- envio */

async function enviar(carta, status, motivo) {
  const nome = revisor();
  if (nome.length < 3) {
    avisar('Escreva quem está revisando antes de decidir.', true);
    $('revisor').focus();
    return;
  }

  for (const b of document.querySelectorAll('.botao-acao')) b.disabled = true;
  try {
    const resposta = await fetch('/api/curadoria', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: carta.id, status, revisor: nome, motivo }),
    });
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro || ('HTTP ' + resposta.status));

    avisar(`Carta ${carta.numeroNaCarta ?? carta.id} — ${ROTULO[status]}.`, false);
    await recarregar();
  } catch (erro) {
    avisar('Não deu: ' + erro.message, true);
    atualizarRevisor();
  }
}

async function recarregar() {
  const [resCartas, resRevisoes] = await Promise.all([
    fetch('/api/cards?draft=1', { cache: 'no-store' }),
    fetch('/api/curadoria', { cache: 'no-store' }),
  ]);
  CARTAS = ((await resCartas.json()).cards || []).sort((a, b) => (a.numeroNaCarta ?? 0) - (b.numeroNaCarta ?? 0));
  if (resRevisoes.ok) REVISOES = (await resRevisoes.json()).revisoes || {};
  montarFiltros();
  desenhar();
}

let relogioRecado = null;
function avisar(texto, erro) {
  const recado = $('recado');
  recado.textContent = texto;
  recado.classList.toggle('recado--erro', Boolean(erro));
  recado.hidden = false;
  clearTimeout(relogioRecado);
  relogioRecado = setTimeout(() => { recado.hidden = true; }, 5000);
}

carregar().catch((erro) => {
  const carregando = $('carregando');
  if (carregando) carregando.textContent = 'não foi possível carregar: ' + erro.message;
});
