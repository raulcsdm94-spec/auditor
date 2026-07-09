import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/** Padrões textuais que sugerem rate limiting visível ao utilizador. */
const PADROES_RATE_LIMIT = [
  "demasiadas tentativas",
  "too many attempts",
  "muitas tentativas",
  "tente novamente mais tarde",
  "try again later",
  "limite de tentativas",
  "conta bloqueada",
  "account locked",
  "rate limit",
];

/**
 * Verifica formulários de login/registo: se submetem sobre HTTPS e se há
 * sinais visíveis de rate limiting. Não submete credenciais nem testa o
 * comportamento — apenas analisa o HTML e o texto da página.
 */
const check: RegisteredCheck = {
  id: "sec.login-forms",
  categoria: "seguranca",
  titulo: "Formulários de autenticação: HTTPS e indícios de rate limiting",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];
    const authForms = crawl.forms.filter((f) => f.isAuthLike);

    if (authForms.length === 0) {
      findings.push({
        id: "sec.login-forms.nenhum",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Nenhum formulário de login/registo detetado nesta página.",
      });
      return findings;
    }

    for (const [i, form] of authForms.entries()) {
      const submeteHttps = form.resolvedAction.startsWith("https://");
      if (!submeteHttps) {
        findings.push({
          id: `sec.login-forms.http.${i}`,
          categoria: "seguranca",
          severidade: "critico",
          descricao:
            "Formulário de autenticação submete dados sobre ligação não cifrada (HTTP).",
          evidencia: `action=${form.resolvedAction} method=${form.method}`,
          remediacao: "Submeter sempre formulários de autenticação sobre HTTPS.",
        });
      }
    }

    // Rate limiting visível (heurística textual)
    const texto = crawl.visibleText;
    const temSinalRateLimit = PADROES_RATE_LIMIT.some((p) => texto.includes(p));
    if (!temSinalRateLimit) {
      findings.push({
        id: "sec.login-forms.sem-rate-limit-visivel",
        categoria: "seguranca",
        severidade: "info",
        descricao:
          "Não há indícios visíveis de rate limiting/proteção contra força bruta nos formulários de autenticação.",
        evidencia:
          "Nenhuma mensagem do tipo 'demasiadas tentativas' foi encontrada (verificação passiva, não conclusiva).",
        remediacao:
          "Confirmar com o cliente se existe rate limiting / CAPTCHA / bloqueio temporário no backend.",
      });
    } else {
      findings.push({
        id: "sec.login-forms.rate-limit-visivel",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Detetados indícios textuais de rate limiting nos formulários.",
      });
    }

    return findings;
  },
};

export default check;
