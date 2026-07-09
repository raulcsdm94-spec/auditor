import { RegisteredCheck, Finding } from "../../types";
import { encontrarPadrao } from "./_shared";

/**
 * Verifica se a informação obrigatória da empresa está visível: identificação
 * (nome/sede/contactos) e identificador fiscal (NIPC/NIF em PT).
 */
const check: RegisteredCheck = {
  id: "legal.info-empresa",
  categoria: "legal",
  titulo: "Informação obrigatória da empresa (identificação e NIPC/NIF)",
  run(crawl, ctx): Finding[] {
    const findings: Finding[] = [];
    const r = ctx.legalRules.patterns;

    const fiscal = encontrarPadrao(crawl, r.identificadorFiscal);
    if (!fiscal) {
      findings.push({
        id: "legal.info-empresa.sem-id-fiscal",
        categoria: "legal",
        severidade: "alto",
        descricao: "Não foi encontrado identificador fiscal (NIPC/NIF) no site.",
        remediacao: ctx.legalRules.remediacao.identificadorFiscal,
      });
    } else {
      findings.push({
        id: "legal.info-empresa.id-fiscal.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Identificador fiscal (NIPC/NIF) presente.",
        evidencia: `Correspondência: "${fiscal.match}"`,
      });
    }

    const info = encontrarPadrao(crawl, r.infoEmpresa);
    if (!info) {
      findings.push({
        id: "legal.info-empresa.sem-identificacao",
        categoria: "legal",
        severidade: "medio",
        descricao:
          "Informação de identificação da empresa (sede/morada/contactos) não claramente visível.",
        remediacao: ctx.legalRules.remediacao.infoEmpresa,
      });
    } else {
      findings.push({
        id: "legal.info-empresa.identificacao.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Informação de identificação da empresa encontrada.",
        evidencia: `Correspondência: "${info.match}"`,
      });
    }

    return findings;
  },
};

export default check;
