#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { Command } from "commander";
import { lerCsv } from "./inputs";

/**
 * Pipeline "uma pasta, um comando": lê o CSV (websites,emails) que está na
 * pasta do projeto, corre a auditoria a todos os sites, gera os relatórios
 * DENTRO da mesma pasta, e depois envia os emails.
 *
 * Por omissão faz auditoria + PREVIEW do envio (dry-run, não envia nada).
 * Só envia mesmo com --send. É só editar o CSV na pasta e voltar a correr.
 */

const AUDITOR_DIR = path.resolve(__dirname, "..");
const DEFAULT_DIR = path.join(AUDITOR_DIR, "VERIS Auto Mail Project");
const TS_NODE = path.join(AUDITOR_DIR, "node_modules", ".bin", "ts-node");

interface AutoOpts {
  dir: string;
  csv?: string;
  send: boolean;
  audit: boolean;
  country: string;
  concurrency: string;
  onlyWithEmail: boolean;
  mailbox?: string;
  maxPerDay?: string;
  delayMs?: string;
  limit?: string;
  strategy?: string;
  incluirTodos: boolean;
  sync: boolean;
}

/** Encontra o CSV de leads na pasta (ignora os ficheiros gerados com prefixo _). */
function encontrarCsv(dir: string): string | null | "multiplos" {
  if (!fs.existsSync(dir)) return null;
  const csvs = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csv") && !f.startsWith("_"))
    .map((f) => path.join(dir, f));
  if (csvs.length === 0) return null;
  if (csvs.length > 1) return "multiplos";
  return csvs[0];
}

function correr(bin: string, args: string[]): number {
  const r = spawnSync(bin, args, { stdio: "inherit", cwd: AUDITOR_DIR });
  if (r.error) {
    console.error(`✖ Não consegui executar: ${r.error.message}`);
    return 1;
  }
  return r.status ?? 1;
}

/**
 * Espelha o resumo na Google Sheet partilhada (best-effort: um erro aqui nunca
 * faz o pipeline falhar). `comFicheiros=false` no sync pós-envio, que só precisa
 * de virar o "Email enviado" (os ficheiros já subiram na fase de auditoria).
 */
function sincronizar(reportsDir: string, strategy: string | undefined, comFicheiros: boolean): void {
  const syncArgs = [
    path.join(AUDITOR_DIR, "src", "sync-sheet.ts"),
    "--out", reportsDir,
    "--strategy", strategy || "classico",
  ];
  if (!comFicheiros) syncArgs.push("--no-files");
  const codigo = correr(TS_NODE, syncArgs);
  if (codigo !== 0) {
    console.error("⚠️  A sincronização com a Google Sheet falhou (o resumo local está na mesma). Continuo.");
  }
}

function main() {
  const program = new Command();
  program
    .name("veris-automail")
    .description("Audita todos os sites do CSV da pasta e envia os emails (dry-run por omissão).")
    .option("--dir <pasta>", "pasta do projeto (onde está o CSV de leads)", DEFAULT_DIR)
    .option("--csv <ficheiro>", "CSV específico (por omissão procura um .csv na pasta)")
    .option("--send", "envia mesmo (sem isto faz auditoria + preview do envio)", false)
    .option("--no-audit", "salta a auditoria (usa os relatórios já gerados na pasta)")
    .option("--country <code>", "país do ruleset legal", "pt")
    .option("--concurrency <n>", "sites a auditar em paralelo", "2")
    .option("--no-only-with-email", "auditar também sites sem email na lista")
    .option("--mailbox <email>", "caixa de envio (passa ao send)")
    .option("--max-per-day <n>", "limite de envios por dia (passa ao send)")
    .option("--delay-ms <n>", "pausa entre envios em ms (passa ao send)")
    .option("--limit <n>", "processa no máximo N leads (auditoria e envio)")
    .option("--strategy <tipo>", "estratégia de email: 'classico' (com relatório) ou 'coldcall' (sem anexo)")
    .option("--incluir-todos", "envia mesmo para sites sem problemas sérios (ignora a regra de elegibilidade)", false)
    .option("--no-sync", "não sincroniza com a Google Sheet partilhada (por omissão sincroniza se o webhook estiver configurado)")
    .parse(process.argv);
  const opts = program.opts<AutoOpts>();

  const dir = path.resolve(process.cwd(), opts.dir);
  fs.mkdirSync(dir, { recursive: true });

  let csv = opts.csv ? path.resolve(process.cwd(), opts.csv) : null;
  if (!csv) {
    const achado = encontrarCsv(dir);
    if (achado === null) {
      console.error(
        `✖ Não encontrei nenhum CSV em:\n  ${dir}\n\n` +
          `Põe lá um ficheiro .csv com duas colunas (websites,emails) e volta a correr.`
      );
      process.exitCode = 3;
      return;
    }
    if (achado === "multiplos") {
      console.error(
        `✖ Há mais do que um .csv em ${dir}. Indica qual com --csv <ficheiro>.`
      );
      process.exitCode = 3;
      return;
    }
    csv = achado;
  }
  if (!fs.existsSync(csv)) {
    console.error(`✖ CSV não encontrado: ${csv}`);
    process.exitCode = 3;
    return;
  }

  // Pré-verificação amigável: CSV sem leads ainda (ex. só o cabeçalho).
  const leads = lerCsv(csv);
  const comEmail = leads.filter((l) => l.email);
  if (leads.length === 0) {
    console.log(
      `ℹ️  O CSV ainda não tem leads:\n  ${csv}\n\n` +
        `Adiciona uma linha por negócio (websites,emails) e volta a correr. Exemplo:\n` +
        `  websites,emails\n  https://exemplo.pt,geral@exemplo.pt`
    );
    return;
  }
  if (opts.onlyWithEmail && comEmail.length === 0) {
    console.log(
      `ℹ️  O CSV tem ${leads.length} site(s), mas nenhum com email. ` +
        `Sem email não dá para enviar. Preenche a coluna de emails (ou usa --no-only-with-email só para auditar).`
    );
    return;
  }

  const reportsDir = path.join(dir, "reports");
  console.log(`📂 Pasta:   ${dir}`);
  console.log(`📄 CSV:     ${csv}  (${leads.length} lead(s), ${comEmail.length} com email)`);
  console.log(`📊 Reports: ${reportsDir}\n`);

  // 1) Auditoria de todos os sites do CSV → relatórios dentro da pasta.
  if (opts.audit) {
    console.log("═══ 1/2 · Auditoria ═══\n");
    const auditArgs = [
      path.join(AUDITOR_DIR, "src", "cli.ts"),
      "--csv", csv,
      "--out", reportsDir,
      "--country", opts.country,
      "--concurrency", opts.concurrency,
    ];
    if (opts.onlyWithEmail) auditArgs.push("--only-with-email");
    const codigo = correr(TS_NODE, auditArgs);
    if (codigo !== 0) {
      console.error(`\n✖ Auditoria terminou com erro (código ${codigo}). Não vou avançar para o envio.`);
      process.exitCode = codigo;
      return;
    }
  } else {
    console.log("(--no-audit) A saltar a auditoria, uso os relatórios já existentes.\n");
  }

  // 1b) Sincroniza o resumo (com ficheiros) para a Google Sheet partilhada,
  // para o cofundador poder rever os emails antes do envio.
  if (opts.sync) {
    console.log("\n═══ Sincronização com a folha partilhada ═══\n");
    sincronizar(reportsDir, opts.strategy, true);
  }

  // 2) Envio (dry-run por omissão; só envia mesmo com --send).
  console.log(`\n═══ 2/2 · Envio ${opts.send ? "(A SÉRIO)" : "(preview / dry-run)"} ═══\n`);
  const sendArgs = [path.join(AUDITOR_DIR, "src", "send.ts"), "--out", reportsDir];
  if (opts.send) sendArgs.push("--send");
  if (opts.mailbox) sendArgs.push("--mailbox", opts.mailbox);
  if (opts.maxPerDay) sendArgs.push("--max-per-day", opts.maxPerDay);
  if (opts.delayMs) sendArgs.push("--delay-ms", opts.delayMs);
  if (opts.limit) sendArgs.push("--limit", opts.limit);
  if (opts.strategy) sendArgs.push("--strategy", opts.strategy);
  if (opts.incluirTodos) sendArgs.push("--incluir-todos");
  const codigoSend = correr(TS_NODE, sendArgs);

  // 2b) Depois de enviar a sério, volta a sincronizar (sem ficheiros) só para
  // virar o "Email enviado" → Sim na folha partilhada.
  if (opts.sync && opts.send && codigoSend === 0) {
    console.log("\n═══ Atualização do estado de envio na folha partilhada ═══\n");
    sincronizar(reportsDir, opts.strategy, false);
  }

  process.exitCode = codigoSend;
}

main();
