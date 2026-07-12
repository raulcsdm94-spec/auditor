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

    // Só faz sentido exigir termos de cancelamento antes do pagamento quando o
    // site processa mesmo pagamento online. Sites de reserva sem pagamento
    // (apenas pedido/marcação) ficam de fora — o ponto não lhes é aplicável.
    if (!crawl.processaPagamento) {
      return [
        {
          id: "legal.reservas.sem-pagamento-online",
          categoria: "legal",
          severidade: "info",
          descricao:
            "Site de reservas sem pagamento online; verificação de termos de cancelamento antes do pagamento não aplicável.",
        },
      ];
    }

    const termos = encontrarPadrao(crawl, ctx.legalRules.patterns.termosCancelamento);
    if (!termos) {
      // Antes de concluir que os termos faltam, é preciso ter conseguido chegar
      // à página de checkout/pagamento (onde apareceriam). Se não a alcançámos,
      // suprimimos a conclusão para não gerar um falso positivo.
      if (!crawl.checkoutAlcancado) {
        return [
          {
            id: "legal.reservas.checkout-inacessivel",
            categoria: "legal",
            severidade: "info",
            descricao:
              "Não foi possível alcançar a página de checkout/pagamento para verificar os termos de cancelamento; conclusão suprimida.",
          },
        ];
      }
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
