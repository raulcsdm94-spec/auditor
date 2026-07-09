import { RegisteredCheck, Finding } from "../../types";
import { encontrarPadrao } from "./_shared";

/**
 * Checks aplicáveis a lojas online: direito de livre resolução de 14 dias
 * e política de cancelamento/reembolso. Só corre se o site foi classificado
 * como e-commerce (ver detecção em checks/index.ts e CheckContext.isEcommerce).
 */
const check: RegisteredCheck = {
  id: "legal.ecommerce",
  categoria: "legal",
  titulo: "Loja online: direito de retratação (14 dias) e política de reembolso",
  run(crawl, ctx): Finding[] {
    if (!ctx.isEcommerce) {
      return [
        {
          id: "legal.ecommerce.nao-aplicavel",
          categoria: "legal",
          severidade: "info",
          descricao: "Site não classificado como loja online; checks de e-commerce ignorados.",
        },
      ];
    }

    const findings: Finding[] = [];
    const r = ctx.legalRules.patterns;

    const retratacao = encontrarPadrao(crawl, r.direitoRetratacao);
    if (!retratacao) {
      findings.push({
        id: "legal.ecommerce.sem-direito-retratacao",
        categoria: "legal",
        severidade: "alto",
        descricao:
          "Loja online sem informação clara sobre o direito de livre resolução de 14 dias.",
        remediacao: ctx.legalRules.remediacao.direitoRetratacao,
      });
    } else {
      findings.push({
        id: "legal.ecommerce.direito-retratacao.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Informação sobre direito de retratação de 14 dias encontrada.",
        evidencia: `Correspondência: "${retratacao.match}"`,
      });
    }

    const reembolso = encontrarPadrao(crawl, r.politicaReembolso);
    if (!reembolso) {
      findings.push({
        id: "legal.ecommerce.sem-politica-reembolso",
        categoria: "legal",
        severidade: "medio",
        descricao: "Loja online sem política de cancelamento/reembolso visível.",
        remediacao: ctx.legalRules.remediacao.politicaReembolso,
      });
    } else {
      findings.push({
        id: "legal.ecommerce.politica-reembolso.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Política de cancelamento/reembolso encontrada.",
        evidencia: `Correspondência: "${reembolso.match}"`,
      });
    }

    return findings;
  },
};

export default check;
