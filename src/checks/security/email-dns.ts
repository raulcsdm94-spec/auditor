import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/**
 * Segurança de email/domínio a partir da resolução DNS (passiva, pública):
 * SPF e DMARC impedem que terceiros falsifiquem emails do domínio; CAA limita
 * que autoridades podem emitir certificados. Lê crawl.dns, recolhido no crawler.
 */
const check: RegisteredCheck = {
  id: "sec.email",
  categoria: "seguranca",
  titulo: "Segurança de email do domínio (SPF, DMARC, MX, CAA)",
  run(crawl: CrawlResult): Finding[] {
    const d = crawl.dns;
    const dom = d.dominio;
    const findings: Finding[] = [];

    // Se o DNS não resolveu de todo, não inventamos findings.
    if (
      d.erros.length &&
      !d.spf &&
      !d.dmarc &&
      d.mx.length === 0 &&
      d.caa.length === 0
    ) {
      return [
        {
          id: "sec.email.indisponivel",
          categoria: "seguranca",
          severidade: "info",
          descricao: "Não foi possível resolver DNS do domínio (rede indisponível ou bloqueada).",
          evidencia: d.erros.join("\n"),
        },
      ];
    }

    // ---- SPF ----
    if (!d.spf) {
      findings.push({
        id: "sec.email.spf-missing",
        categoria: "seguranca",
        severidade: "alto",
        descricao: `Sem registo SPF para ${dom}.`,
        remediacao:
          "Publicar um registo SPF (TXT) que liste os servidores autorizados e termine em -all.",
      });
    } else if (/\+all/i.test(d.spf) || !/[~-]all/i.test(d.spf)) {
      findings.push({
        id: "sec.email.spf-permissivo",
        categoria: "seguranca",
        severidade: "medio",
        descricao: "Registo SPF presente mas permissivo (sem -all/~all, ou com +all).",
        evidencia: d.spf,
        remediacao: "Terminar o SPF em -all (rejeitar) ou ~all (softfail).",
      });
    } else {
      findings.push({
        id: "sec.email.spf.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Registo SPF presente.",
        evidencia: d.spf,
      });
    }

    // ---- DMARC ----
    if (!d.dmarc) {
      findings.push({
        id: "sec.email.dmarc-missing",
        categoria: "seguranca",
        severidade: "alto",
        descricao: `Sem registo DMARC para ${dom}.`,
        remediacao:
          "Publicar um registo DMARC (_dmarc) com política p=quarantine ou p=reject.",
      });
    } else if (/p=none/i.test(d.dmarc)) {
      findings.push({
        id: "sec.email.dmarc-monitorizacao",
        categoria: "seguranca",
        severidade: "medio",
        descricao: "DMARC presente mas em modo monitorização (p=none): não bloqueia falsificações.",
        evidencia: d.dmarc,
        remediacao: "Avançar para p=quarantine e depois p=reject após validar o tráfego legítimo.",
      });
    } else {
      findings.push({
        id: "sec.email.dmarc.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao: "DMARC presente com política de enforcement.",
        evidencia: d.dmarc,
      });
    }

    // ---- CAA ----
    if (d.caa.length === 0) {
      findings.push({
        id: "sec.email.caa-missing",
        categoria: "seguranca",
        severidade: "info",
        descricao:
          "Sem registos CAA: qualquer autoridade certificadora pode emitir certificados para o domínio.",
        remediacao: "Adicionar registos CAA que limitem a emissão de certificados às CAs usadas.",
      });
    }

    // ---- MX (contexto) ----
    if (d.mx.length === 0 && d.erros.length === 0) {
      findings.push({
        id: "sec.email.sem-mx",
        categoria: "seguranca",
        severidade: "info",
        descricao:
          "Sem registos MX: o domínio aparenta não receber email (SPF/DMARC continuam a prevenir falsificação em seu nome).",
      });
    }

    return findings;
  },
};

export default check;
