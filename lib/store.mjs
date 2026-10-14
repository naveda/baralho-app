/**
 * Persistência local — o overlay de tópicos fica no aparelho do usuário.
 *
 * Nada é enviado a servidor: além de ser mais simples, opinião política é dado
 * sensível (LGPD art. 5º, II) e não precisa sair da máquina para o app funcionar.
 *
 * As funções aceitam um `storage` injetado para poderem ser testadas no Node.
 */
import { overlayVazio, normalizarOverlay } from './topics.mjs';

export const CHAVE_OVERLAY = 'baralho.topicos.v1';

const padrao = () => globalThis.localStorage;

/** localStorage existe e aceita escrita? (modo privado do Safari pode negar) */
export function disponivel(storage = padrao()) {
  try {
    const sonda = '__baralho_sonda__';
    storage.setItem(sonda, '1');
    storage.removeItem(sonda);
    return true;
  } catch {
    return false;
  }
}

export function lerOverlay(storage = padrao()) {
  try {
    const bruto = storage?.getItem(CHAVE_OVERLAY);
    if (!bruto) return overlayVazio();
    return normalizarOverlay(JSON.parse(bruto));
  } catch {
    return overlayVazio();
  }
}

export function gravarOverlay(overlay, storage = padrao()) {
  try {
    storage.setItem(CHAVE_OVERLAY, JSON.stringify(overlay));
    return true;
  } catch {
    return false;
  }
}

export function limparOverlay(storage = padrao()) {
  try {
    storage.removeItem(CHAVE_OVERLAY);
    return true;
  } catch {
    return false;
  }
}

/** Exporta legível para o usuário guardar/compartilhar. */
export function exportarOverlay(overlay) {
  return JSON.stringify({ ...overlay, exportadoEm: new Date().toISOString(), app: 'baralho-app' }, null, 2);
}

export function importarOverlay(texto) {
  return normalizarOverlay(JSON.parse(texto));
}

export default {
  CHAVE_OVERLAY,
  disponivel,
  lerOverlay,
  gravarOverlay,
  limparOverlay,
  exportarOverlay,
  importarOverlay,
};
