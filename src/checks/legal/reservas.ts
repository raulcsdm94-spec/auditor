import { RegisteredCheck, Finding } from "../../types";
import { encontrarPadrao } from "./_shared";

/**
 * Check aplicável a sites de reservas/marcações: presença de termos de
 * cancelamento (idealmente antes da confirmação de pagamento). Só corre se
 * o site foi classificado como de reservas (CheckContext.isBooking).
 */
const check: RegisteredCheck = {
  id: "legal.reservas",
  categoria: "legal",
  titulo: "Site de reservas: termos de cancelamento antes do pagamento",
  run(crawl, ctx): Finding[] {
    if (!ctx.isBooking) {
      return [
        {
          id: "legal.reservas.nao-aplicavel",
          categoria: "legal",
          severidade: "info",
          descricao: "Site não classificado como de reservas; check ignorado.",
        },
      ];
    }

    const termos = encontrarPadrao(crawl, ctx.legalRules.patterns.termosCancelamento);
    if (!termos) {
      return [
        {
          id: "legal.reservas.sem-termos-cancelamento",
          categoria: "legal",
          severidade: "alto",
          descricao:
            "Site de reservas sem termos de cancelamento visíveis antes da confirmação de pagamento.",
          remediacao: ctx.legalRules.remediacao.termosCancelamento,
        },
      ];
    }

    return [
      {
        id: "legal.reservas.termos-cancelamento.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Termos de cancelamento encontrados.",
        evidencia: `Correspondência: "${termos.match}"`,
      },
    ];
  },
};

export default check;
