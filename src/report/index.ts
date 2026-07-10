import * as fs from "fs";
import * as path from "path";
import { Finding, CrawlResult } from "../types";
import { gerarMarkdown, DadosRelatorio } from "./markdown";
import { gerarPdf } from "./pdf";
import { gerarEmailOutreach, gerarEmailOutreachColdCall } from "./email";

export interface ResultadoRelatorio {
  /** Relatório interno completo da VERIS (inclui remediação). */
  markdownPath?: string;
  pdfPath?: string;
  markdown?: string;
  /** Relatório do cliente: diagnóstico sem os passos de correção. */
  clienteMarkdownPath?: string;
  clientePdfPath?: string;
  clienteMarkdown?: string;
  /** Email de outreach clássico (com relatório anexado, texto simples). */
  emailPath?: string;
  email?: string;
  /** Email de outreach cold call (sem anexo, bait para responder, texto simples). */
  emailColdCallPath?: string;
  emailColdCall?: string;
}

export interface OpcoesRelatorio {
  crawl: CrawlResult;
  findings: Finding[];
  country: string;
  /** Diretório base onde criar a pasta do relatório. */
  outBaseDir: string;
  /** Não gerar PDF (útil em ambientes sem render). */
  semPdf?: boolean;
  /**
   * Que relatórios gerar:
   * - "ambos" (default): interno + cliente.
   * - "cliente": apenas o relatório do cliente (sem passos de correção).
   * - "interno": apenas o relatório interno completo da VERIS.
   */
  alvo?: "ambos" | "cliente" | "interno";
}

/** Cria um slug seguro para nome de pasta a partir do URL. */
function slugDoUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/[^\w.-]/g, "_");
  } catch {
    return url.replace(/[^\w.-]/g, "_").slice(0, 40);
  }
}

/**
 * Deriva um nome de empresa legível a partir do domínio, para o nome dos
 * ficheiros do cliente (ex. https://www.belemtejo.pt → "Belemtejo",
 * boavista.bessahotel.com → "Bessahotel"). Usa a label registável (a que fica
 * antes do TLD), o que funciona bem para os TLDs de label única (.pt/.com/.es/.eu).
 */
function nomeEmpresa(url: string): string {
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(url) ? url : `http://${url}`).hostname;
  } catch {
    host = url;
  }
  const labels = host.replace(/^www\./i, "").split(".").filter(Boolean);
  const registavel = labels.length >= 2 ? labels[labels.length - 2] : labels[0] || "empresa";
  return (
    registavel
      .split("-")
      .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
      .join("-")
      .replace(/[^\w-]/g, "") || "Empresa"
  );
}

/** Agrega os resultados e escreve o relatório em Markdown e PDF. */
export async function gerarRelatorio(opts: OpcoesRelatorio): Promise<ResultadoRelatorio> {
  const geradoEm = new Date();
  const carimbo = geradoEm.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = path.join(opts.outBaseDir, `${slugDoUrl(opts.crawl.requestedUrl)}_${carimbo}`);
  fs.mkdirSync(dir, { recursive: true });

  const dadosBase = {
    crawl: opts.crawl,
    findings: opts.findings,
    country: opts.country,
    geradoEm,
  };

  const alvo = opts.alvo ?? "ambos";
  const fazInterno = alvo === "ambos" || alvo === "interno";
  const fazCliente = alvo === "ambos" || alvo === "cliente";

  // Nome dos ficheiros do cliente (o que o cliente vê): VERIS_Relatorio_<Empresa>.
  const baseCliente = `VERIS_Relatorio_${nomeEmpresa(opts.crawl.requestedUrl)}`;

  const resultado: ResultadoRelatorio = {};

  // 1. Relatório INTERNO (VERIS) — completo, com remediação.
  if (fazInterno) {
    const interno: DadosRelatorio = { ...dadosBase, audiencia: "interno" };
    resultado.markdown = gerarMarkdown(interno);
    resultado.markdownPath = path.join(dir, "relatorio.md");
    fs.writeFileSync(resultado.markdownPath, resultado.markdown, "utf-8");
  }

  // 2. Relatório do CLIENTE — diagnóstico sem os passos de correção.
  if (fazCliente) {
    const clienteDados: DadosRelatorio = { ...dadosBase, audiencia: "cliente" };
    resultado.clienteMarkdown = gerarMarkdown(clienteDados);
    resultado.clienteMarkdownPath = path.join(dir, `${baseCliente}.md`);
    fs.writeFileSync(resultado.clienteMarkdownPath, resultado.clienteMarkdown, "utf-8");
  }

  // Mover o screenshot (se existir) para a pasta do relatório.
  if (opts.crawl.screenshotPath && fs.existsSync(opts.crawl.screenshotPath)) {
    try {
      const destino = path.join(dir, "screenshot.png");
      if (path.resolve(opts.crawl.screenshotPath) !== path.resolve(destino)) {
        fs.copyFileSync(opts.crawl.screenshotPath, destino);
      }
    } catch {
      /* não crítico */
    }
  }

  if (!opts.semPdf) {
    if (resultado.markdown) {
      resultado.pdfPath = path.join(dir, "relatorio.pdf");
      await gerarPdf(resultado.markdown, resultado.pdfPath);
    }
    if (resultado.clienteMarkdown) {
      resultado.clientePdfPath = path.join(dir, `${baseCliente}.pdf`);
      await gerarPdf(resultado.clienteMarkdown, resultado.clientePdfPath);
    }
  }

  // Emails de outreach (ambas as estratégias, sempre gerados para escolher qual usar).
  resultado.email = gerarEmailOutreach(opts.crawl, opts.findings);
  resultado.emailPath = path.join(dir, "email-outreach.txt");
  fs.writeFileSync(resultado.emailPath, resultado.email, "utf-8");

  resultado.emailColdCall = gerarEmailOutreachColdCall(opts.crawl, opts.findings);
  resultado.emailColdCallPath = path.join(dir, "email-coldcall.txt");
  fs.writeFileSync(resultado.emailColdCallPath, resultado.emailColdCall, "utf-8");

  return resultado;
}
