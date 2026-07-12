import { RegisteredCheck, Finding } from "../../types";
import { encontrarPadrao } from "./_shared";

/**
 * Verifica a presença de Política de Privacidade e Política de Cookies.
 */
const check: RegisteredCheck = {
  id: "legal.politicas",
  categoria: "legal",
  titulo: "Política de Privacidade e Política de Cookies",
  run(crawl, ctx): Finding[] {
    const findings: Finding[] = [];
    const r = ctx.legalRules.patterns;

    const privacidade = encontrarPadrao(crawl, r.politicaPrivacidade);
    if (privacidade) {
      findings.push({
        id: "legal.politica-privacidade.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Política de Privacidade encontrada.",
        evidencia: `Correspondência: "${privacidade.match}"`,
      });
    } else {
      findings.push({
        id: "legal.politica-privacidade.missing",
        categoria: "legal",
        severidade: "critico",
        descricao:
          "O website não apresenta uma Política de Privacidade facilmente acessível para informar os utilizadores sobre o tratamento dos seus dados pessoais.",
        remediacao: ctx.legalRules.remediacao.politicaPrivacidade,
      });
    }

    const cookies = encontrarPadrao(crawl, r.politicaCookies);
    if (cookies) {
      findings.push({
        id: "legal.politica-cookies.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Política de Cookies encontrada.",
        evidencia: `Correspondência: "${cookies.match}"`,
      });
    } else {
      findings.push({
        id: "legal.politica-cookies.missing",
        categoria: "legal",
        severidade: "alto",
        descricao: "Não foi encontrada Política de Cookies.",
        remediacao: ctx.legalRules.remediacao.politicaCookies,
      });
    }

    return findings;
  },
};

export default check;
