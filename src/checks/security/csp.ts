import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/**
 * Avalia a QUALIDADE da Content-Security-Policy (não apenas a presença, que é
 * coberta pelo check de headers). Uma CSP com 'unsafe-inline'/'unsafe-eval' ou
 * origens wildcard oferece pouca proteção real contra XSS.
 */
const check: RegisteredCheck = {
  id: "sec.csp-quality",
  categoria: "seguranca",
  titulo: "Qualidade da Content-Security-Policy",
  run(crawl: CrawlResult): Finding[] {
    const csp = crawl.headers["content-security-policy"];
    if (!csp) return []; // a ausência é reportada pelo check de headers
    const v = csp.toLowerCase();
    const evidencia = csp.slice(0, 300);
    const findings: Finding[] = [];

    if (v.includes("'unsafe-inline'")) {
      findings.push({
        id: "sec.csp-quality.unsafe-inline",
        categoria: "seguranca",
        severidade: "medio",
        descricao: "A CSP permite 'unsafe-inline', anulando grande parte da proteção contra XSS.",
        evidencia,
        remediacao: "Remover 'unsafe-inline' e usar nonces/hashes para scripts e estilos.",
      });
    }
    if (v.includes("'unsafe-eval'")) {
      findings.push({
        id: "sec.csp-quality.unsafe-eval",
        categoria: "seguranca",
        severidade: "medio",
        descricao: "A CSP permite 'unsafe-eval', permitindo execução dinâmica de código.",
        evidencia,
        remediacao: "Remover 'unsafe-eval' e eliminar dependências de eval()/new Function().",
      });
    }
    if (/(?:script-src|default-src)[^;]*\*/.test(v)) {
      findings.push({
        id: "sec.csp-quality.wildcard",
        categoria: "seguranca",
        severidade: "medio",
        descricao:
          "A CSP usa uma origem wildcard (*) em script-src/default-src, permitindo carregar scripts de qualquer domínio.",
        evidencia,
        remediacao: "Substituir * por uma lista explícita de origens de confiança.",
      });
    }
    if (!v.includes("frame-ancestors")) {
      findings.push({
        id: "sec.csp-quality.sem-frame-ancestors",
        categoria: "seguranca",
        severidade: "info",
        descricao: "A CSP não define frame-ancestors (proteção adicional contra clickjacking).",
        evidencia,
        remediacao: "Adicionar frame-ancestors 'self' (ou origens específicas) à CSP.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: "sec.csp-quality.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao: "CSP presente e sem fraquezas óbvias detetadas.",
        evidencia,
      });
    }
    return findings;
  },
};

export default check;
