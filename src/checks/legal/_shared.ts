import { CrawlResult } from "../../types";

/**
 * Procura, de forma case-insensitive, qualquer um dos padrões no conteúdo
 * da página (HTML completo + texto visível). Devolve o primeiro padrão
 * encontrado como evidência, ou null se nenhum corresponder.
 */
export function encontrarPadrao(
  crawl: CrawlResult,
  patterns: string[]
): { match: string } | null {
  const haystack = (crawl.html + "\n" + crawl.visibleText).toLowerCase();
  for (const p of patterns) {
    const needle = p.toLowerCase();
    if (haystack.includes(needle)) return { match: p };
  }
  return null;
}

/** Extrai um excerto curto à volta da primeira ocorrência, para evidência. */
export function excerto(crawl: CrawlResult, termo: string, janela = 80): string {
  const texto = crawl.visibleText || crawl.html.toLowerCase();
  const idx = texto.indexOf(termo.toLowerCase());
  if (idx < 0) return termo;
  const ini = Math.max(0, idx - janela);
  const fim = Math.min(texto.length, idx + termo.length + janela);
  return "…" + texto.slice(ini, fim).replace(/\s+/g, " ").trim() + "…";
}
