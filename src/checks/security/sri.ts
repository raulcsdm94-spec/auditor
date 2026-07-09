import { RegisteredCheck, Finding, CrawlResult } from "../../types";

function hostDe(u: string): string | null {
  try {
    return new URL(u).host;
  } catch {
    return null;
  }
}

/**
 * Subresource Integrity (SRI): sinaliza <script>/<link rel=stylesheet> de
 * terceiros carregados sem atributo integrity. Sem SRI, um recurso externo
 * comprometido executa no site sem deteção (risco de cadeia de fornecimento).
 * Análise puramente textual sobre o HTML já recolhido.
 */
const check: RegisteredCheck = {
  id: "sec.sri",
  categoria: "seguranca",
  titulo: "Subresource Integrity (SRI) em recursos de terceiros",
  run(crawl: CrawlResult): Finding[] {
    const hostPagina = hostDe(crawl.finalUrl);
    if (!hostPagina) return [];

    const semSri: string[] = [];

    const verificar = (tag: string, attr: "src" | "href") => {
      const m = new RegExp(`\\b${attr}\\s*=\\s*["']([^"']+)["']`, "i").exec(tag);
      if (!m) return;
      let url = m[1];
      if (url.startsWith("//")) url = "https:" + url;
      const host = hostDe(url);
      if (!host || host === hostPagina) return; // apenas terceiros
      if (!/\bintegrity\s*=/i.test(tag)) semSri.push(url);
    };

    const scriptTags = crawl.html.match(/<script\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/gi) || [];
    for (const t of scriptTags) verificar(t, "src");

    const linkTags = crawl.html.match(/<link\b[^>]*>/gi) || [];
    for (const t of linkTags) {
      if (/rel\s*=\s*["'][^"']*stylesheet/i.test(t)) verificar(t, "href");
    }

    const unicos = Array.from(new Set(semSri));
    if (unicos.length === 0) {
      return [
        {
          id: "sec.sri.ok",
          categoria: "seguranca",
          severidade: "info",
          descricao:
            "Sem scripts/estilos de terceiros sem integridade detetados (ou já usam SRI).",
        },
      ];
    }

    return [
      {
        id: "sec.sri.em-falta",
        categoria: "seguranca",
        severidade: "medio",
        descricao: `${unicos.length} recurso(s) externo(s) carregado(s) sem Subresource Integrity (SRI).`,
        evidencia: unicos.slice(0, 6).join("\n"),
        remediacao:
          "Adicionar atributos integrity (hash SRI) e crossorigin aos <script>/<link> de terceiros.",
      },
    ];
  },
};

export default check;
