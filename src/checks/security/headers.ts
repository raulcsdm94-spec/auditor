import { RegisteredCheck, Finding, CrawlResult, Severidade } from "../../types";

interface HeaderRule {
  header: string;
  id: string;
  severidade: Severidade;
  descricao: string;
  remediacao: string;
}

/** Headers de segurança esperados e a gravidade da sua ausência. */
const REGRAS: HeaderRule[] = [
  {
    header: "content-security-policy",
    id: "csp",
    severidade: "alto",
    descricao: "Header Content-Security-Policy (CSP) em falta.",
    remediacao:
      "Definir uma CSP restritiva para mitigar XSS e injeção de conteúdo.",
  },
  {
    header: "strict-transport-security",
    id: "hsts",
    severidade: "alto",
    descricao: "Header Strict-Transport-Security (HSTS) em falta.",
    remediacao:
      "Adicionar HSTS (ex. max-age=31536000; includeSubDomains) para forçar HTTPS.",
  },
  {
    header: "x-frame-options",
    id: "x-frame-options",
    severidade: "medio",
    descricao: "Header X-Frame-Options em falta (risco de clickjacking).",
    remediacao:
      "Definir X-Frame-Options: DENY/SAMEORIGIN ou usar frame-ancestors na CSP.",
  },
  {
    header: "x-content-type-options",
    id: "x-content-type-options",
    severidade: "medio",
    descricao: "Header X-Content-Type-Options em falta (MIME sniffing).",
    remediacao: "Definir X-Content-Type-Options: nosniff.",
  },
  {
    header: "referrer-policy",
    id: "referrer-policy",
    severidade: "info",
    descricao: "Header Referrer-Policy em falta.",
    remediacao:
      "Definir Referrer-Policy (ex. strict-origin-when-cross-origin) para limitar fuga de URLs.",
  },
];

/** Verifica a presença dos principais headers de segurança HTTP. */
const check: RegisteredCheck = {
  id: "sec.headers",
  categoria: "seguranca",
  titulo: "Headers de segurança HTTP",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];
    const presentes: string[] = [];

    for (const r of REGRAS) {
      const valor = crawl.headers[r.header];
      if (!valor) {
        findings.push({
          id: `sec.headers.${r.id}-missing`,
          categoria: "seguranca",
          severidade: r.severidade,
          descricao: r.descricao,
          evidencia: `Header "${r.header}" não presente na resposta de ${crawl.finalUrl}.`,
          remediacao: r.remediacao,
        });
      } else {
        presentes.push(`${r.header}: ${valor}`);
      }
    }

    // Sinalizar HSTS sem max-age robusto
    const hsts = crawl.headers["strict-transport-security"];
    if (hsts) {
      const match = /max-age=(\d+)/i.exec(hsts);
      const maxAge = match ? parseInt(match[1], 10) : 0;
      if (maxAge < 15552000) {
        findings.push({
          id: "sec.headers.hsts-max-age-baixo",
          categoria: "seguranca",
          severidade: "info",
          descricao: "HSTS presente mas com max-age baixo (< 180 dias).",
          evidencia: hsts,
          remediacao: "Aumentar max-age para pelo menos 15552000 (180 dias).",
        });
      }
    }

    if (presentes.length > 0) {
      findings.push({
        id: "sec.headers.presentes",
        categoria: "seguranca",
        severidade: "info",
        descricao: `${presentes.length} header(s) de segurança presentes.`,
        evidencia: presentes.join("\n"),
      });
    }

    return findings;
  },
};

export default check;
