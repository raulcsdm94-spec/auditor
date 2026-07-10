#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { parseCsv } from "./inputs";
import { parseEmailFile } from "./report/parse-email-file";
import { buildEmailHtml, LOGO_CID } from "./report/email-html";
import { loadGraphConfig, sendMail } from "./graph/mail";
import { loadEnv } from "./env";

/** Logótipo VERIS embutido na assinatura (versão leve para email). */
const LOGO_PATH = path.resolve(__dirname, "..", "..", "brand", "veris-mark-email.png");

/**
 * Envia os emails de outreach diretamente via Microsoft Graph
 * (`_resumo-auditorias.csv` → subject+body de email-outreach.txt + PDF anexado).
 *
 * Por omissão corre em dry-run (não envia nada, só mostra o que faria).
 * Só envia mesmo com --send explícito. Tem limite diário e salta leads já
 * enviados (log persistente), para nunca duplicar um envio nem disparar em
 * excesso.
 */

interface SendOpts {
  out: string;
  send: boolean;
  mailbox?: string;
  maxPerDay: string;
  delayMs: string;
  limit?: string;
  strategy: string;
}

interface SentLogEntry {
  url: string;
  email: string;
  sentAt: string;
}
type SentLog = Record<string, SentLogEntry>;

function idFicheiro(url: string): string {
  return (
    url
      .replace(/^https?:\/\//i, "")
      .replace(/[^\w.-]/g, "_")
      .replace(/_+$/g, "") || "lead"
  );
}

function lerSentLog(p: string): SentLog {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function enviadosHoje(log: SentLog): number {
  const inicioHoje = new Date();
  inicioHoje.setHours(0, 0, 0, 0);
  return Object.values(log).filter((e) => new Date(e.sentAt).getTime() >= inicioHoje.getTime()).length;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ResultRow {
  url: string;
  email: string;
  estado: string;
  sentAt: string;
  erro: string;
}

function escreverResultadosCsv(p: string, rows: ResultRow[]): void {
  const header = "url,email,estado,sentAt,erro";
  const linhas = rows.map((r) =>
    [r.url, r.email, r.estado, r.sentAt, r.erro]
      .map((v) => `"${(v || "").replace(/"/g, '""')}"`)
      .join(",")
  );
  fs.writeFileSync(p, [header, ...linhas].join("\n") + "\n", "utf-8");
}

async function main() {
  loadEnv();

  const program = new Command();
  program
    .name("veris-send")
    .description("Envia os emails de outreach via Microsoft Graph (dry-run por omissão).")
    .option("--out <dir>", "pasta dos relatórios (onde está o _resumo-auditorias.csv)", "reports")
    .option("--send", "envia mesmo (sem isto corre sempre em dry-run)", false)
    .option("--mailbox <email>", "caixa de envio (por omissão GRAPH_SENDER_MAILBOX do .env)")
    .option("--max-per-day <n>", "limite de envios por dia", "30")
    .option("--delay-ms <n>", "pausa entre envios em ms", "4000")
    .option("--limit <n>", "processa no máximo N leads elegíveis nesta corrida (útil para testar)")
    .option("--strategy <tipo>", "estratégia de email: 'classico' (com relatório) ou 'coldcall' (sem anexo)", "classico")
    .parse(process.argv);
  const opts = program.opts<SendOpts>();

  const strategy = (opts.strategy || "classico").toLowerCase();
  if (strategy !== "classico" && strategy !== "coldcall") {
    console.error("✖ --strategy deve ser 'classico' ou 'coldcall'.");
    process.exitCode = 3;
    return;
  }

  const outDir = path.resolve(process.cwd(), opts.out);
  const resumoPath = path.join(outDir, "_resumo-auditorias.csv");
  if (!fs.existsSync(resumoPath)) {
    console.error(`✖ Não encontrei ${resumoPath}. Corre primeiro uma auditoria (npm run audit).`);
    process.exitCode = 3;
    return;
  }

  const maxPerDay = parseInt(opts.maxPerDay, 10);
  const delayMs = parseInt(opts.delayMs, 10);
  const limit = opts.limit ? parseInt(opts.limit, 10) : Infinity;

  let graphCfg: ReturnType<typeof loadGraphConfig> | null = null;
  if (opts.send) {
    try {
      graphCfg = loadGraphConfig(opts.mailbox);
    } catch (e) {
      console.error(`✖ ${(e as Error).message}`);
      process.exitCode = 3;
      return;
    }
  }

  const logPath = path.join(outDir, "_sent-log.json");
  const log = lerSentLog(logPath);
  let jaHoje = enviadosHoje(log);

  const rows = parseCsv(fs.readFileSync(resumoPath, "utf-8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iUrl = col("url");
  const iEmail = col("email");
  const iPdf = col("relatorio_cliente_pdf");
  const iEmailFile = strategy === "coldcall" ? col("email_coldcall") : col("email_outreach");
  const iEstado = col("estado");

  // Email columns podem não existir em resumos antigos; validar
  if (iEmailFile === -1) {
    console.error(
      `✖ Coluna 'email_${strategy === "coldcall" ? "coldcall" : "outreach"}' não encontrada no CSV. ` +
        "Corre novamente uma auditoria para gerar o resumo com as novas colunas."
    );
    process.exitCode = 3;
    return;
  }

  let jaEnviados = 0;
  let semEmail = 0;
  let semFicheiros = 0;
  let saltadosCap = 0;
  let processados = 0;
  let enviados = 0;
  let falhados = 0;
  const wouldSend: ResultRow[] = [];
  const resultados: ResultRow[] = [];

  for (const row of rows.slice(1)) {
    const url = (row[iUrl] || "").trim();
    const email = (row[iEmail] || "").trim();
    const pdf = (row[iPdf] || "").trim();
    const emailFile = (row[iEmailFile] || "").trim();
    const estado = (row[iEstado] || "").trim();

    if (estado !== "ok") continue;
    if (!email) {
      semEmail++;
      continue;
    }
    const precisa_pdf = strategy === "classico";
    if (!emailFile || !fs.existsSync(emailFile)) {
      semFicheiros++;
      continue;
    }
    if (precisa_pdf && (!pdf || !fs.existsSync(pdf))) {
      semFicheiros++;
      continue;
    }

    const id = idFicheiro(url);
    if (log[id]) {
      jaEnviados++;
      continue;
    }

    if (processados >= limit) break;

    if (jaHoje >= maxPerDay) {
      saltadosCap++;
      continue;
    }

    processados++;
    const { subject, body } = parseEmailFile(fs.readFileSync(emailFile, "utf-8"));
    const html = buildEmailHtml(body);

    if (!opts.send) {
      let infoAnexo = "";
      if (strategy === "classico") {
        const kb = (fs.statSync(pdf).size / 1024).toFixed(0);
        infoAnexo = ` | anexo: ${path.basename(pdf)} (${kb} KB)`;
      } else {
        infoAnexo = " | sem anexo (cold call)";
      }
      console.log(`[dry-run] → ${email} | "${subject}"${infoAnexo}`);
      wouldSend.push({ url, email, estado: "dry-run", sentAt: "", erro: "" });
      continue;
    }

    try {
      const attachments: { path: string; contentType: string; contentId?: string }[] = [
        { path: LOGO_PATH, contentType: "image/png", contentId: LOGO_CID },
      ];
      if (strategy === "classico") {
        attachments.unshift({ path: pdf, contentType: "application/pdf" });
      }

      await sendMail(graphCfg!, {
        to: email,
        subject,
        bodyText: body,
        html,
        attachments: attachments as any,
      });
      const sentAt = new Date().toISOString();
      log[id] = { url, email, sentAt };
      jaHoje++;
      enviados++;
      resultados.push({ url, email, estado: "enviado", sentAt, erro: "" });
      console.log(`✔ enviado → ${email} (${url})`);
    } catch (e) {
      falhados++;
      resultados.push({ url, email, estado: "falhou", sentAt: "", erro: (e as Error).message });
      console.error(`✖ falhou → ${email} (${url}): ${(e as Error).message}`);
    }

    if (opts.send && processados < limit) await sleep(delayMs);
  }

  if (opts.send) {
    fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
    if (resultados.length) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      escreverResultadosCsv(path.join(outDir, `_send-results-${ts}.csv`), resultados);
    }
  }

  console.log(
    `\n${opts.send ? "Envio" : "Dry-run"} concluído: ${opts.send ? enviados + " enviados" : wouldSend.length + " enviaria(m)"}` +
      `${falhados ? `, ${falhados} falhado(s)` : ""}, ${jaEnviados} já enviados antes (saltados), ` +
      `${saltadosCap} saltados por limite diário, ${semEmail} sem email, ${semFicheiros} sem PDF/email-outreach.`
  );
  if (!opts.send) {
    console.log("Nada foi enviado. Corre novamente com --send para enviar a sério.");
  }
}

main().catch((e) => {
  console.error(`✖ Erro inesperado: ${(e as Error).message}`);
  process.exitCode = 1;
});
