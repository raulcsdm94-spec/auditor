import { RegisteredCheck, Finding } from "../../types";
import { encontrarPadrao } from "./_shared";

/**
 * Verifica a presença de link/widget para o Livro de Reclamações Eletrónico,
 * obrigatório para prestadores de serviços (DL 74/2017, em PT).
 */
const check: RegisteredCheck = {
  id: "legal.livro-reclamacoes",
  categoria: "legal",
  titulo: "Livro de Reclamações Eletrónico",
  run(crawl, ctx): Finding[] {
    const found = encontrarPadrao(crawl, ctx.legalRules.patterns.livroReclamacoes);
    if (found) {
      return [
        {
          id: "legal.livro-reclamacoes.ok",
          categoria: "legal",
          severidade: "info",
          descricao: "Link/menção ao Livro de Reclamações Eletrónico encontrado.",
          evidencia: `Correspondência: "${found.match}"`,
        },
      ];
    }
    return [
      {
        id: "legal.livro-reclamacoes.missing",
        categoria: "legal",
        severidade: "alto",
        descricao: "Não foi encontrado link/widget para o Livro de Reclamações Eletrónico.",
        remediacao: ctx.legalRules.remediacao.livroReclamacoes,
      },
    ];
  },
};

export default check;
