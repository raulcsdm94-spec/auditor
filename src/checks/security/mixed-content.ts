import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/** Recursos cuja carga sobre HTTP compromete ativamente a página (não só conteúdo passivo). */
const ATIVOS = new Set(["script", "stylesheet", "xhr", "fetch", "websocket", "eventsource"]);

/**
 * Conteúdo misto: recursos carregados sobre HTTP numa página servida por
 * HTTPS. Trabalha sobre os pedidos de rede já recolhidos pelo crawler.
 */
const check: RegisteredCheck = {
  id: "sec.mixed-content",
  categoria: "seguranca",
  titulo: "Conteúdo misto (recursos HTTP em páginas HTTPS)",
  run(crawl: CrawlResult): Finding[] {
    if (!crawl.tls.isHttps) return []; // sem HTTPS o problema é outro (ver check TLS)

    const inseguros = crawl.requests.filter((r) => /^http:\/\//i.test(r.url));
    if (inseguros.length === 0) {
      return [
        {
          id: "sec.mixed-content.ok",
          categoria: "seguranca",
          severidade: "info",
          descricao: "Sem conteúdo misto: todos os recursos carregam sobre HTTPS.",
        },
      ];
    }

    const temAtivo = inseguros.some((r) => ATIVOS.has(r.resourceType));
    const exemplos = Array.from(new Set(inseguros.map((r) => r.url))).slice(0, 6);

    return [
      {
        id: temAtivo ? "sec.mixed-content.ativo" : "sec.mixed-content.passivo",
        categoria: "seguranca",
        severidade: temAtivo ? "alto" : "medio",
        descricao: temAtivo
          ? `Conteúdo misto ativo: ${inseguros.length} recurso(s) (scripts/estilos/pedidos) carregados sobre HTTP numa página HTTPS.`
          : `Conteúdo misto passivo: ${inseguros.length} recurso(s) (imagens/media) carregados sobre HTTP numa página HTTPS.`,
        evidencia: exemplos.join("\n"),
        remediacao:
          "Servir todos os recursos sobre HTTPS (atualizar URLs http:// para https://).",
      },
    ];
  },
};

export default check;
