#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { carregarRuleset } from "./checks";
import { auditarSite, OpcoesAuditoria } from "./audit-run";
import { AlvoInput, lerCsv, lerLista, parseUrlsArg } from "./inputs";

interface CliOpts {
  url?: string;
  urls?: string;
  csv?: string;
  list?: string;
  country: string;
  out: string;
  ecommerce?: boolean;
  booking?: boolean;
  // Commander mapeia --no-pdf/--no-screenshot/--no-dns para false.
  pdf: boolean;
  screenshot: boolean;
  dns: boolean;
  timeout: string;
  clienteOnly?: boolean;
  internoOnly?: boolean;
  maxPages: string;
  singlePage?: boolean;
  concurrency: string;
  onlyWithEmail?: boolean;
}

function csvEscape(s: string): string {
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Executa `fn` sobre `items` com no máximo `n` em paralelo, preservando a ordem. */
async function correrPool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const i = idx++;
      if (i >= items.length) break;
      results[i] = await fn(items[i], i);
    }
  };
  const trabalhadores = Math.max(1, Math.min(n, items.length));
  await Promise.all(Array.from({ length: trabalhadores }, () => worker()));
  return results;
}

/** Junta e dedup os alvos de todas as fontes (--url/--urls/--list/--csv). */
function recolherAlvos(opts: CliOpts): AlvoInput[] {
  const alvos: AlvoInput[] = [];
  if (opts.url) alvos.push({ url: opts.url });
  if (opts.urls) alvos.push(...parseUrlsArg(opts.urls));
  if (opts.list) alvos.push(...lerLista(path.resolve(process.cwd(), opts.list)));
  if (opts.csv) alvos.push(...lerCsv(path.resolve(process.cwd(), opts.csv)));

  const vistos = new Set<string>();
  return alvos.filter((a) => {
    const k = (a.url || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (!k || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
}

async function main() {
  const program = new Command();
  program
    .name("website-auditor")
    .description("Auditoria passiva de segurança e conformidade legal de websites (uso autorizado).")
    .option("--url <url>", "auditar um único site")
    .option("--urls <lista>", "vários URLs separados por vírgula")
    .option("--csv <ficheiro>", "CSV (ex. do scraper) de onde extrair os websites (e emails)")
    .option("--list <ficheiro>", "ficheiro de texto com um URL por linha")
    .option("--country <code>", "país do ruleset legal (ex. pt, es)", "pt")
    .option("--out <dir>", "diretório de saída dos relatórios", "reports")
    .option("--ecommerce", "forçar classificação como loja online")
    .option("--booking", "forçar classificação como site de reservas")
    .option("--no-pdf", "não gerar PDF, apenas Markdown")
    .option("--no-screenshot", "não capturar screenshot")
    .option("--cliente-only", "gerar apenas o relatório do cliente")
    .option("--interno-only", "gerar apenas o relatório interno completo")
    .option("--max-pages <n>", "nº máximo de páginas por site", "5")
    .option("--single-page", "analisar apenas o URL (sem subpáginas)")
    .option("--no-dns", "não resolver DNS (saltar SPF/DMARC/CAA)")
    .option("--concurrency <n>", "nº de sites a auditar em paralelo", "2")
    .option("--only-with-email", "auditar apenas os sites que têm email na lista/CSV")
    .option("--timeout <ms>", "timeout de navegação em ms", "30000")
    .parse(process.argv);

  const opts = program.opts<CliOpts>();

  if (opts.clienteOnly && opts.internoOnly) {
    console.error("✖ --cliente-only e --interno-only são mutuamente exclusivos.");
    process.exitCode = 3;
    return;
  }
  const alvo: "ambos" | "cliente" | "interno" = opts.clienteOnly
    ? "cliente"
    : opts.internoOnly
    ? "interno"
    : "ambos";

  let targets = recolherAlvos(opts);
  if (opts.onlyWithEmail) {
    const antes = targets.length;
    targets = targets.filter((a) => !!a.email);
    const ignorados = antes - targets.length;
    if (ignorados > 0) {
      console.log(`(--only-with-email) ${ignorados} site(s) sem email ignorados.`);
    }
  }
  if (targets.length === 0) {
    console.error("✖ Nenhum site a auditar. Usa --url, --urls, --list ou --csv (e confirma que há emails se usares --only-with-email).");
    process.exitCode = 3;
    return;
  }

  const outBaseDir = path.resolve(process.cwd(), opts.out);
  const legalRules = carregarRuleset(opts.country); // valida o país cedo
  const oAudit: OpcoesAuditoria = {
    country: opts.country,
    legalRules,
    outBaseDir,
    semPdf: !opts.pdf,
    noScreenshot: !opts.screenshot,
    maxPages: opts.singlePage ? 1 : parseInt(opts.maxPages, 10) || 5,
    noDns: !opts.dns,
    alvo,
    timeoutMs: parseInt(opts.timeout, 10) || 30000,
    ecommerce: opts.ecommerce,
    booking: opts.booking,
  };
  const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 1);

  console.log("⚠️  Scanner PASSIVO para uso AUTORIZADO. Confirme o consentimento dos alvos.\n");
  console.log(
    `→ ${targets.length} site(s) a auditar · ruleset ${opts.country} · ${concurrency} em paralelo\n`
  );

  const t0 = Date.now();
  const resumos = await correrPool(targets, concurrency, async (item, i) => {
    const n = `[${i + 1}/${targets.length}]`;
    console.log(`${n} → ${item.url}`);
    const r = await auditarSite(item.url, oAudit);
    if (r.ok) {
      console.log(
        `${n} ✔ ${r.finalUrl} · críticos=${r.criticos} altos=${r.altos} médios=${r.medios}` +
          (r.dir ? ` · ${path.basename(r.dir)}` : "")
      );
    } else {
      console.log(`${n} ✖ falhou: ${r.erro}`);
    }
    return r;
  });

  // CSV-resumo para abrir no Excel.
  fs.mkdirSync(outBaseDir, { recursive: true });
  const resumoCsvPath = path.join(outBaseDir, "_resumo-auditorias.csv");
  const cabecalho = [
    "url", "url_final", "estado", "criticos", "altos", "medios",
    "email", "pasta", "relatorio_cliente_pdf", "email_outreach", "email_coldcall", "erro",
  ];
  const linhas = [cabecalho.join(",")];
  resumos.forEach((r, i) => {
    linhas.push(
      [
        r.url,
        r.finalUrl || "",
        r.ok ? "ok" : "erro",
        String(r.criticos),
        String(r.altos),
        String(r.medios),
        targets[i].email || "",
        r.dir || "",
        r.clientePdf || "",
        r.emailPath || "",
        r.emailColdCallPath || "",
        r.erro || "",
      ]
        .map(csvEscape)
        .join(",")
    );
  });
  fs.writeFileSync(resumoCsvPath, linhas.join("\n") + "\n", "utf-8");

  const ok = resumos.filter((r) => r.ok).length;
  const falhas = resumos.length - ok;
  const dur = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\n✔ Concluído em ${dur}s. ${ok} com sucesso, ${falhas} com erro.`);
  console.log(`  Relatórios em:  ${outBaseDir}`);
  console.log(`  Resumo (Excel): ${resumoCsvPath}`);

  process.exitCode = ok === 0 ? 3 : 0;
}

main().catch((err) => {
  console.error("\n✖ Erro:", err instanceof Error ? err.message : err);
  process.exitCode = 3;
});
