/**
 * CSV — leitura e escrita no formato RFC 4180, sem dependências.
 *
 * Por que à mão: o projeto é zero-dep, e o CSV é o formato em que a pesquisa é
 * editada (planilha). Ele precisa aguentar aspas, vírgulas e quebras de linha
 * dentro dos campos — as citações e as observações têm os três.
 *
 * Regras seguidas:
 *  - separador: vírgula;
 *  - campo com vírgula, aspas ou quebra de linha vai entre aspas duplas;
 *  - aspas dentro do campo viram aspas duplas dobradas;
 *  - CRLF ou LF entre registros (na escrita, sempre CRLF);
 *  - BOM opcional na leitura (planilhas adoram gravar BOM).
 */

/**
 * Converte texto CSV em linhas de campos.
 * @param {string} texto
 * @returns {string[][]}
 */
export function parseCsv(texto) {
  const semBom = texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
  const linhas = [];
  let campo = '';
  let linha = [];
  let dentroDeAspas = false;
  let i = 0;

  while (i < semBom.length) {
    const c = semBom[i];

    if (dentroDeAspas) {
      if (c === '"') {
        if (semBom[i + 1] === '"') {
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeAspas = false;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === '"') {
      // aspas só abrem campo no começo dele; no meio, são literais
      if (campo === '') {
        dentroDeAspas = true;
        i++;
        continue;
      }
      campo += c;
      i++;
      continue;
    }

    if (c === ',') {
      linha.push(campo);
      campo = '';
      i++;
      continue;
    }

    if (c === '\r' || c === '\n') {
      if (c === '\r' && semBom[i + 1] === '\n') i++;
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = '';
      i++;
      continue;
    }

    campo += c;
    i++;
  }

  // último registro sem quebra no fim
  if (campo !== '' || linha.length) {
    linha.push(campo);
    linhas.push(linha);
  }

  if (dentroDeAspas) throw new Error('CSV malformado: aspas abertas sem fechar');

  return linhas;
}

/**
 * Converte linhas em objetos, usando a primeira linha como cabeçalho.
 * Linhas em branco são ignoradas; campos sobrando ou faltando viram erro, porque
 * silêncio aqui é dado perdido.
 * @param {string[][]} linhas
 * @returns {{colunas: string[], registros: Record<string,string>[]}}
 */
export function paraObjetos(linhas) {
  const uteis = linhas.filter((l) => l.some((c) => c.trim() !== ''));
  if (!uteis.length) return { colunas: [], registros: [] };

  const colunas = uteis[0].map((c) => c.trim());
  if (new Set(colunas).size !== colunas.length) {
    throw new Error('CSV com colunas repetidas no cabeçalho');
  }

  const registros = uteis.slice(1).map((linha, indice) => {
    if (linha.length > colunas.length) {
      throw new Error(`linha ${indice + 2}: ${linha.length} campos para ${colunas.length} colunas`);
    }
    const obj = {};
    colunas.forEach((nome, i) => { obj[nome] = linha[i] === undefined ? '' : linha[i]; });
    return obj;
  });

  return { colunas, registros };
}

/** Escapa um campo, citando só quando é preciso. */
export function campoCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  if (/[",\r\n]/.test(texto)) return '"' + texto.replace(/"/g, '""') + '"';
  return texto;
}

/**
 * Monta o texto CSV a partir de colunas e registros.
 * @param {string[]} colunas
 * @param {Array<Record<string, unknown>>} registros
 * @param {{quebra?: string, bom?: boolean}} [opcoes]
 */
export function escreverCsv(colunas, registros, opcoes = {}) {
  const { quebra = '\r\n', bom = false } = opcoes;
  const linhas = [colunas.map(campoCsv).join(',')];
  for (const registro of registros) {
    linhas.push(colunas.map((c) => campoCsv(registro[c])).join(','));
  }
  return (bom ? '\ufeff' : '') + linhas.join(quebra) + quebra;
}

export default { parseCsv, paraObjetos, escreverCsv, campoCsv };
