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
  const bruto = (crawl.html + "\n" + crawl.visibleText).toLowerCase();
  // Segunda versão do texto com separadores de URL/slug (-, _, /) trocados por
  // espaços: assim um link de rodapé como "/politica-de-cookies" ou
  // "privacidade_cookies" também corresponde ao padrão "política de cookies".
  const normalizado = bruto.replace(/[-_/]+/g, " ");
  for (const p of patterns) {
    const needle = p.toLowerCase();
    if (bruto.includes(needle) || normalizado.includes(needle)) return { match: p };
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
