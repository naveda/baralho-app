/**
 * Página de créditos — renderiza `data/creditos.json` (via /api/creditos).
 *
 * O conteúdo é dado, não código: para mudar nomes, papéis, links ou textos,
 * edite o JSON. Aqui só há a montagem da página.
 */

const $ = (id) => document.getElementById(id);

function criar(tag, classe, texto) {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto != null) el.textContent = texto;
  return el;
}

/**
 * Texto do JSON com marcação leve permitida: <code>, <strong>, <em>, <br>.
 * Escapa tudo primeiro e só então reabre essas tags — sem atributos, sem script.
 */
function comMarcacao(texto) {
  const el = document.createElement('p');
  const escapado = String(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  el.innerHTML = escapado.replace(/&lt;(\/?)(code|strong|em|br)\s*\/?&gt;/gi, '<$1$2>');
  return el;
}

/** Conteúdo de um texto com marcação, sem o <p> de fora. */
const conteudoComMarcacao = (texto) => comMarcacao(texto).childNodes;

function montarLista(pontos, classe = 'creditos-lista') {
  const ul = criar('ul', classe);
  for (const ponto of pontos) {
    const li = document.createElement('li');
    li.append(...conteudoComMarcacao(ponto));
    ul.append(li);
  }
  return ul;
}

function cartaoPessoa(pessoa) {
  const cartao = criar('article', 'pessoa');
  cartao.append(criar('h3', null, pessoa.nome));
  if (pessoa.papel) cartao.append(criar('p', 'pessoa__papel', pessoa.papel));
  if (pessoa.afiliacao) cartao.append(criar('p', 'pessoa__afiliacao', pessoa.afiliacao));
  if (pessoa.nomeCompleto && pessoa.nomeCompleto !== pessoa.nome) {
    cartao.append(criar('p', 'pessoa__completo', pessoa.nomeCompleto));
  }
  if (Array.isArray(pessoa.links) && pessoa.links.length) {
    const linha = criar('p', 'pessoa__links');
    for (const link of pessoa.links) {
      const a = criar('a', null, link.rotulo);
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linha.append(a);
    }
    cartao.append(linha);
  }
  return cartao;
}

function blocoSecao(bloco) {
  const secao = criar('section', 'credito-bloco');
  secao.id = 'credito-' + bloco.id;
  if (bloco.id === 'aviso') secao.classList.add('credito-bloco--aviso');

  secao.append(criar('h2', null, bloco.titulo));
  if (bloco.texto) secao.append(comMarcacao(bloco.texto));

  if (Array.isArray(bloco.pessoas)) {
    const grade = criar('div', 'pessoas');
    for (const pessoa of bloco.pessoas) grade.append(cartaoPessoa(pessoa));
    secao.append(grade);
  }

  if (Array.isArray(bloco.fatos)) {
    const dl = criar('dl', 'fatos');
    for (const fato of bloco.fatos) {
      dl.append(criar('dt', null, fato.rotulo));
      dl.append(criar('dd', null, fato.valor));
    }
    secao.append(dl);
  }

  if (Array.isArray(bloco.links) && bloco.links.length) {
    const linha = criar('p', 'bloco__links');
    for (const link of bloco.links) {
      const a = criar('a', null, link.rotulo);
      a.href = link.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      linha.append(a);
    }
    secao.append(linha);
  }

  if (Array.isArray(bloco.pontos)) secao.append(montarLista(bloco.pontos));

  if (Array.isArray(bloco.itens)) {
    const lista = criar('ul', 'softwares');
    for (const item of bloco.itens) {
      const li = document.createElement('li');
      const cabeca = criar('p', 'software__cabeca');
      cabeca.append(criar('strong', null, item.nome));
      if (item.versao) cabeca.append(criar('span', 'software__versao', item.versao));
      if (item.licenca) cabeca.append(criar('span', 'software__licenca', item.licenca));
      li.append(cabeca);
      if (item.autor) li.append(criar('p', 'software__autor', item.autor));
      if (item.uso) li.append(criar('p', 'software__uso', item.uso));
      lista.append(li);
    }
    secao.append(lista);
  }

  if (bloco.tipografia) secao.append(comMarcacao(bloco.tipografia));

  if (bloco.ressalva) {
    const caixa = criar('div', 'ressalva');
    caixa.append(...conteudoComMarcacao(bloco.ressalva));
    secao.append(caixa);
  }

  return secao;
}

function blocoCitacao(dados) {
  if (!dados) return null;
  const secao = criar('section', 'credito-bloco credito-bloco--citacao');
  secao.append(criar('h2', null, dados.titulo || 'Como citar'));
  const caixa = criar('div', 'citacao');
  caixa.append(criar('p', 'citacao__texto', dados.citacao));
  const botao = criar('button', 'mini', 'copiar citação');
  botao.type = 'button';
  botao.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dados.citacao);
      botao.textContent = 'copiado ✓';
    } catch {
      botao.textContent = 'selecione e copie';
    }
    setTimeout(() => (botao.textContent = 'copiar citação'), 2200);
  });
  caixa.append(botao);
  secao.append(caixa);
  return secao;
}

async function iniciar() {
  const resposta = await fetch('/api/creditos', { cache: 'no-store' });
  if (!resposta.ok) throw new Error('GET /api/creditos → ' + resposta.status);
  const dados = await resposta.json();

  const conteudo = $('conteudo');
  conteudo.innerHTML = '';

  const cabecalho = criar('header', 'creditos-cabecalho');
  cabecalho.append(criar('h1', null, dados.titulo || 'Créditos'));
  if (dados.subtitulo) cabecalho.append(criar('p', 'creditos-cabecalho__sub', dados.subtitulo));
  conteudo.append(cabecalho);

  for (const bloco of dados.blocos || []) conteudo.append(blocoSecao(bloco));

  const citacao = blocoCitacao(dados.citacaoRecomendada);
  if (citacao) conteudo.append(citacao);

  $('resumo').textContent = (dados.blocos || []).length + ' seções';
  $('rodape-atualizado').textContent = dados.atualizadoEm
    ? 'Atualizado em ' + dados.atualizadoEm.split('-').reverse().join('/')
    : '';
  document.title = 'Baralho — ' + (dados.titulo || 'créditos');
}

iniciar().catch((erro) => {
  const conteudo = $('conteudo');
  conteudo.innerHTML = '';
  conteudo.append(criar('p', 'carregando', 'Não foi possível carregar os créditos: ' + erro.message));
  $('resumo').textContent = 'sem dados';
});
