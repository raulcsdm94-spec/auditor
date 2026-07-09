import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/**
 * Verifica as flags de segurança dos cookies definidos pelo site:
 * Secure, HttpOnly e SameSite.
 */
const check: RegisteredCheck = {
  id: "sec.cookies",
  categoria: "seguranca",
  titulo: "Flags de segurança dos cookies (Secure/HttpOnly/SameSite)",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];

    if (crawl.cookies.length === 0) {
      findings.push({
        id: "sec.cookies.nenhum",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Nenhum cookie foi definido durante o carregamento da página.",
      });
      return findings;
    }

    for (const c of crawl.cookies) {
      const problemas: string[] = [];
      if (crawl.tls.isHttps && !c.secure) problemas.push("sem flag Secure");
      if (!c.httpOnly) problemas.push("sem flag HttpOnly");
      const sameSite = (c.sameSite || "").toLowerCase();
      if (!sameSite || sameSite === "none") {
        problemas.push(`SameSite=${c.sameSite || "ausente"}`);
      }

      if (problemas.length === 0) continue;

      // SameSite=None ou Secure em falta sobre HTTPS são mais graves.
      const severidade =
        crawl.tls.isHttps && !c.secure ? "alto" : "medio";

      findings.push({
        id: `sec.cookies.flags.${c.name}`,
        categoria: "seguranca",
        severidade,
        descricao: `Cookie "${c.name}" com configuração de segurança fraca: ${problemas.join(
          ", "
        )}.`,
        evidencia: `domínio=${c.domain}; path=${c.path}; secure=${c.secure}; httpOnly=${c.httpOnly}; sameSite=${c.sameSite}`,
        remediacao:
          "Definir Secure (em HTTPS), HttpOnly para cookies de sessão e SameSite=Lax/Strict.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: "sec.cookies.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao: `Todos os ${crawl.cookies.length} cookie(s) têm flags de segurança adequadas.`,
      });
    }

    return findings;
  },
};

export default check;
