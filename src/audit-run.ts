import * as path from "path";
import { crawl } from "./crawler/crawl";
import { correrChecks, detetarTipoSite } from "./checks";
import { gerarRelatorio } from "./report";
import { CheckContext, Severidade, LegalRuleset } from "./types";

/** Garante esquema no URL. */
export function normalizarUrl(input: string): string {
  const s = input.trim();
  if (!/^https?:\/\//i.test(s)) return "https://" + s;
  return s;
}

/** Opções partilhadas por todos os sites de uma execução. */
export interface OpcoesAuditoria {
  country: string;
  legalRules: LegalRuleset;
  outBaseDir: string;
  semPdf: boolean;
  noScreenshot: boolean;
  maxPages: number;
  noDns: boolean;
  alvo: "ambos" | "cliente" | "interno";
  timeoutMs: number;
  ecommerce?: boolean;
  booking?: boolean;
}

/** Resultado resumido de um site (para consola + CSV-resumo). */
export interface ResumoSite {
  url: string;
  finalUrl?: string;
  ok: boolean;
  criticos: number;
  altos: number;
  medios: number;
  info: number;
  dir?: string;
  clientePdf?: string;
  emailPath?: string;
  emailColdCallPath?: string;
  erro?: string;
}

/**
 * Audita UM site de ponta a ponta (crawl -> checks -> relatórios + email),
 * criando a sua própria pasta. Nunca lança: erros ficam no `erro` do resumo,
 * para que um site falhado não pare um batch.
 */
export async function auditarSite(inputUrl: string, o: OpcoesAuditoria): Promise<ResumoSite> {
  const url = normalizarUrl(inputUrl);
  try {
    const crawlResult = await crawl({
      url,
      timeoutMs: o.timeoutMs,
      noScreenshot: o.noScreenshot,
      maxPages: o.maxPages,
      noDns: o.noDns,
    });

    const detetado = detetarTipoSite(crawlResult);
    const ctx: CheckContext = {
      country: o.country,
      legalRules: o.legalRules,
      isEcommerce: !!o.ecommerce || detetado.isEcommerce,
      isBooking: !!o.booking || detetado.isBooking,
    };

    const findings = await correrChecks(crawlResult, ctx);
    const rel = await gerarRelatorio({
      crawl: crawlResult,
      findings,
      country: o.country,
      outBaseDir: o.outBaseDir,
      semPdf: o.semPdf,
      alvo: o.alvo,
    });

    const c = (s: Severidade) => findings.filter((f) => f.severidade === s).length;
    const anyMd = rel.clienteMarkdownPath || rel.markdownPath;

    return {
      url,
      finalUrl: crawlResult.finalUrl,
      ok: true,
      criticos: c("critico"),
      altos: c("alto"),
      medios: c("medio"),
      info: c("info"),
      dir: anyMd ? path.dirname(anyMd) : undefined,
      clientePdf: rel.clientePdfPath,
      emailPath: rel.emailPath,
      emailColdCallPath: rel.emailColdCallPath,
    };
  } catch (err) {
    return {
      url,
      ok: false,
      criticos: 0,
      altos: 0,
      medios: 0,
      info: 0,
      erro: err instanceof Error ? err.message : String(err),
    };
  }
}
