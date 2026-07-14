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
          "O website não apresenta uma Política de Privacidade facilmente acessível, o que incumpre o RGPD (Regulamento (UE) 2016/679, arts. 13.º e 14.º, e Lei n.º 58/2019) quanto à informação dos utilizadores sobre o tratamento dos seus dados pessoais.",
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
    } else if (encontrarPadrao(crawl, r.bannerCookies)) {
      // Há um banner de consentimento de cookies mas não localizámos uma página
      // dedicada de "Política de Cookies" — que muitas vezes está integrada na
      // Política de Privacidade ou é aberta pelo próprio banner. Não é um
      // incumprimento reportável: seria um falso positivo dizer "não tem cookies"
      // a um site que visivelmente gere o consentimento. Fica só como nota (info).
      findings.push({
        id: "legal.politica-cookies.integrada",
        categoria: "legal",
        severidade: "info",
        descricao:
          "Banner de consentimento de cookies presente; não foi localizada uma Política de Cookies dedicada (poderá estar integrada na Política de Privacidade).",
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
