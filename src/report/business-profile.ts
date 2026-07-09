import { CrawlResult } from "../types";

/**
 * Deteção CONSERVADORA do modelo de negócio do site, para personalizar o
 * relatório do cliente ("um site lento perde reservas" vs "perde vendas").
 *
 * Regra de ouro: só classificamos quando os sinais são fortes e inequívocos.
 * Na dúvida devolvemos "desconhecido" e o relatório usa o texto genérico —
 * é preferível genérico a parecer copy-paste do modelo de negócio errado.
 */

export type PerfilNegocio =
  | "alojamento"
  | "restauracao"
  | "ecommerce"
  | "servicos"
  | "desconhecido";

export interface DetecaoPerfil {
  perfil: PerfilNegocio;
  /** Sinais que sustentaram a classificação (para debug/log). */
  sinais: string[];
}

/** Frases usadas no relatório quando o perfil é conhecido. */
export interface FrasesPerfil {
  /** Como nos referimos ao negócio (ex. "um alojamento"). */
  rotulo: string;
  /** O que se perde quando um visitante desiste (ex. "uma reserva"). */
  oQuePerde: string;
  /** Consequência para o "Em duas linhas" (frase completa). */
  consequencia: string;
  /** Frase de impacto para site lento. */
  velocidade: string;
  /** Frase de impacto para problemas de confiança (HTTPS, avisos do browser). */
  confianca: string;
}

const FRASES: Record<Exclude<PerfilNegocio, "desconhecido">, FrasesPerfil> = {
  alojamento: {
    rotulo: "um alojamento",
    oQuePerde: "uma reserva",
    consequencia:
      "Para um alojamento que vive de reservas feitas online, cada visitante que desiste a meio é uma reserva que vai para outro site.",
    velocidade:
      "Quem procura onde ficar compara vários sites em minutos. Um site que demora a abrir perde a reserva para o concorrente que abre num instante.",
    confianca:
      "Ninguém deixa dados pessoais ou de pagamento num site que o browser marca como inseguro, e numa reserva é exatamente isso que se pede ao hóspede.",
  },
  restauracao: {
    rotulo: "um restaurante",
    oQuePerde: "um cliente",
    consequencia:
      "Para um restaurante, o site é muitas vezes o primeiro contacto: quem não consegue ver a ementa ou reservar mesa num instante liga para outro.",
    velocidade:
      "Quem procura onde comer decide em segundos. Se a ementa ou o contacto demoram a abrir, o cliente passa ao próximo resultado do Google.",
    confianca:
      "Um aviso de 'site não seguro' à entrada afasta clientes antes sequer de verem a ementa.",
  },
  ecommerce: {
    rotulo: "uma loja online",
    oQuePerde: "uma venda",
    consequencia:
      "Numa loja online, cada um destes pontos custa vendas: visitantes que desistem antes de comprar e carrinhos abandonados a meio.",
    velocidade:
      "Numa loja online, cada segundo de espera custa vendas: a maioria dos visitantes abandona uma página que demora mais de 3 segundos a abrir.",
    confianca:
      "Ninguém introduz o cartão num site que o browser marca como inseguro. Para uma loja online, a confiança é a condição da venda.",
  },
  servicos: {
    rotulo: "um negócio de serviços",
    oQuePerde: "um pedido de orçamento",
    consequencia:
      "Para um negócio que vive de pedidos de contacto e orçamentos, cada visitante que desiste é um potencial cliente que vai pedir orçamento ao concorrente.",
    velocidade:
      "Quem precisa de um serviço compara vários fornecedores. Um site lento ou com avisos de segurança perde o pedido de orçamento para o concorrente.",
    confianca:
      "Quem vai confiar um trabalho (e dados de contacto) a uma empresa começa por julgar o site. Avisos de insegurança minam essa confiança à entrada.",
  },
};

export function frasesDoPerfil(perfil: PerfilNegocio): FrasesPerfil | null {
  if (perfil === "desconhecido") return null;
  return FRASES[perfil];
}

/** Motores de reserva conhecidos (sinal forte de alojamento). */
const MOTORES_RESERVA =
  /siteminder|cloudbeds|mews\.com|guestcentric|bookassist|availpro|thebookingbutton|littlehotelier|octorate|amenitiz|profitroom|roomraccoon|sirvoy|beds24|hotelrunner/i;

function contarMatches(texto: string, padroes: RegExp[]): { n: number; quais: string[] } {
  const quais: string[] = [];
  for (const p of padroes) {
    if (p.test(texto)) quais.push(p.source.slice(0, 40));
  }
  return { n: quais.length, quais };
}

/**
 * Deteta o perfil do negócio. Só devolve um perfil quando há um sinal
 * inequívoco (ex. motor de reservas) ou uma combinação de ≥2 sinais fortes.
 */
export function detetarPerfilNegocio(crawl: CrawlResult): DetecaoPerfil {
  const texto = (crawl.html + " " + crawl.visibleText).toLowerCase();
  const urlsPedidos = crawl.requests.map((r) => r.url).join("\n");

  // 1) Alojamento — motor de reservas é sinal inequívoco.
  if (MOTORES_RESERVA.test(urlsPedidos) || MOTORES_RESERVA.test(texto)) {
    return { perfil: "alojamento", sinais: ["motor de reservas de alojamento detetado"] };
  }
  const alojamento = contarMatches(texto, [
    /check-?in.{0,40}check-?out/s,
    /\b(n[.ºo]{0,2}\s*de\s*)?noites?\b/,
    /\b(quartos?|su[ií]tes?|dormit[oó]rios?)\b/,
    /\b(hotel|hostel|guest\s*house|guesthouse|alojamento\s+local|turismo\s+rural|villa|apartamentos?\s+tur[ií]sticos?)\b/,
    /\b(h[oó]spedes?|estadia|reserve\s+j[aá]|book\s+your\s+stay)\b/,
  ]);
  if (alojamento.n >= 3) {
    return { perfil: "alojamento", sinais: alojamento.quais };
  }

  // 2) Restauração — precisa de comida E de menu/reserva de mesa.
  const restComida = contarMatches(texto, [
    /\b(restaurante|pizzaria|sushi|marisqueira|churrasqueira|hamburgueria|tasca|petiscos|brunch|gelataria|pastelaria|padaria|caf[eé]\b)/,
    /\b(ementa|menu|carta|pratos?\s+do\s+dia|takeaway|take-away)\b/,
    /\b(reservar?\s+(uma\s+)?mesa|reserva\s+de\s+mesa)\b/,
  ]);
  if (restComida.n >= 2) {
    return { perfil: "restauracao", sinais: restComida.quais };
  }

  // 3) Loja online — sinais de carrinho/checkout (inequívocos).
  if (
    /add to cart|adicionar ao carrinho|carrinho de compras|finalizar compra|woocommerce|prestashop|shopify|magento|comprar agora/.test(
      texto
    )
  ) {
    return { perfil: "ecommerce", sinais: ["carrinho/checkout de loja online detetado"] };
  }

  // 4) Serviços — pedido de orçamento explícito + formulário de contacto.
  const temFormulario = crawl.forms.length > 0;
  const pedidoOrcamento =
    /\b(pedir|pe[cç]a|solicite|solicitar|obter)\s+(um\s+)?or[cç]amento\b|or[cç]amento\s+(gr[aá]tis|gratuito|sem\s+compromisso)/.test(
      texto
    );
  if (pedidoOrcamento && temFormulario) {
    return { perfil: "servicos", sinais: ["pedido de orçamento + formulário de contacto"] };
  }

  // Na dúvida: desconhecido → relatório usa o texto genérico.
  return { perfil: "desconhecido", sinais: [] };
}
