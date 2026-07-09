import * as fs from "fs";
import * as path from "path";
import {
  RegisteredCheck,
  Finding,
  CrawlResult,
  CheckContext,
  LegalRuleset,
} from "../types";

// --- Checks de segurança ---
import tls from "./security/tls";
import headers from "./security/headers";
import cookies from "./security/cookies";
import exposure from "./security/exposure";
import fingerprinting from "./security/fingerprinting";
import loginForms from "./security/login-forms";
import mixedContent from "./security/mixed-content";
import csp from "./security/csp";
import sri from "./security/sri";
import emailDns from "./security/email-dns";

// --- Checks legais ---
import livroReclamacoes from "./legal/livro-reclamacoes";
import politicas from "./legal/politicas";
import bannerCookies from "./legal/banner-cookies";
import infoEmpresa from "./legal/info-empresa";
import ecommerce from "./legal/ecommerce";
import reservas from "./legal/reservas";
import trackers from "./legal/trackers";
import acessibilidade from "./legal/acessibilidade";

/**
 * Registo central de todos os checks. Para adicionar um novo check, basta
 * criar o ficheiro, importá-lo aqui e acrescentá-lo a este array.
 */
export const CHECKS: RegisteredCheck[] = [
  tls,
  headers,
  cookies,
  exposure,
  fingerprinting,
  loginForms,
  mixedContent,
  csp,
  sri,
  emailDns,
  livroReclamacoes,
  politicas,
  bannerCookies,
  infoEmpresa,
  ecommerce,
  reservas,
  trackers,
  acessibilidade,
];

/** Mapeia o código de país da CLI para o nome do ficheiro de ruleset. */
const RULESET_POR_PAIS: Record<string, string> = {
  pt: "pt-PT",
  "pt-pt": "pt-PT",
  es: "es-ES",
  "es-es": "es-ES",
};

/** Carrega o ruleset legal de um país a partir de src/rules/legal/<código>.json. */
export function carregarRuleset(country: string): LegalRuleset {
  const key = RULESET_POR_PAIS[country.toLowerCase()];
  if (!key) {
    const disponiveis = Object.keys(RULESET_POR_PAIS).join(", ");
    throw new Error(
      `País "${country}" não suportado. Países/aliases disponíveis: ${disponiveis}.`
    );
  }
  const file = path.join(__dirname, "..", "rules", "legal", `${key}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Ruleset não encontrado: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf-8")) as LegalRuleset;
}

/** Heurística para classificar o tipo de site a partir do crawl. */
export function detetarTipoSite(crawl: CrawlResult): {
  isEcommerce: boolean;
  isBooking: boolean;
} {
  const txt = (crawl.html + " " + crawl.visibleText).toLowerCase();
  const isEcommerce =
    /add to cart|adicionar ao carrinho|carrinho de compras|finalizar compra|checkout|woocommerce|prestashop|shopify|magento|comprar agora/.test(
      txt
    );
  const isBooking =
    /reservar|fazer reserva|book now|booking|marcar|agendar|disponibilidade|check-in|check in|nº de noites/.test(
      txt
    );
  return { isEcommerce, isBooking };
}

/** Corre todos os checks e devolve a lista agregada de findings. */
export async function correrChecks(
  crawl: CrawlResult,
  ctx: CheckContext
): Promise<Finding[]> {
  const todos: Finding[] = [];
  for (const c of CHECKS) {
    try {
      const res = await c.run(crawl, ctx);
      todos.push(...res);
    } catch (e) {
      todos.push({
        id: `${c.id}.erro`,
        categoria: c.categoria,
        severidade: "info",
        descricao: `O check "${c.id}" falhou durante a execução.`,
        evidencia: (e as Error).message,
      });
    }
  }
  return todos;
}
