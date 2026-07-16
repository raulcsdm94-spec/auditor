#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { parseCsv } from "./inputs";
import { parseEmailFile } from "./report/parse-email-file";
import { buildEmailHtml, LOGO_CID } from "./report/email-html";
import { valeAPenaContactar, MOTIVO_NAO_ELEGIVEL } from "./report/outreach";
import { carregarSupressao, estaSuprimido } from "./report/suppression";
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
  incluirTodos: boolean;
  soAprovados: boolean;
}

/** Normaliza um URL para o domínio (sem protocolo/www/caminho), para casar os
 *  aprovados vindos da folha com os leads do resumo. */
function dominioDeUrl(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * Vai buscar à folha partilhada (via doGet do Apps Script) o conjunto de domínios
 * com o checkbox "Aprovado p/ envio" marcado. Só precisa do SHEET_TRACKER_WEBHOOK_URL
 * que já usamos para sincronizar — a folha não tem de ser pública. Lança se não
 * conseguir obter a lista (para nunca enviar sem aprovação por engano).
 */
async function carregarAprovados(): Promise<Set<string>> {
  const base = process.env.SHEET_TRACKER_WEBHOOK_URL;
  if (!base) {
    throw new Error(
      "--so-aprovados precisa do SHEET_TRACKER_WEBHOOK_URL no .env (o mesmo do tracker)."
    );
  }
  const url = base + (base.includes("?") ? "&" : "?") + "action=aprovados";
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`A folha devolveu HTTP ${res.status} ao ler aprovados.`);
  const corpo = (await res.json()) as { ok?: boolean; aprovados?: string[] };
  if (!corpo || corpo.ok === false || !Array.isArray(corpo.aprovados)) {
    throw new Error("Resposta inesperada da folha ao ler aprovados.");
  }
  return new Set(corpo.aprovados.map(dominioDeUrl).filter(Boolean));
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

/**
 * Extrai as linhas de "ponto" (bullets •/●) do corpo de um email, sem o marcador
 * nem a indentação. Servem para o dry-run mostrar exatamente o que cada email
 * afirma — é o momento barato para apanhar um falso positivo antes de enviar.
 */
function extrairPontos(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.match(/^\s*[•●]\s?(.*)$/)?.[1]?.trim())
    .filter((p): p is string => !!p);
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
    .option("--incluir-todos", "envia mesmo para sites sem problemas sérios (ignora a regra de elegibilidade)", false)
    .option("--so-aprovados", "só envia os leads com o checkbox 'Aprovado p/ envio' marcado na folha partilhada", false)
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

  const supressao = carregarSupressao(outDir);
  if (supressao.tamanho > 0) {
    console.log(`🚫 Lista de supressão: ${supressao.tamanho} entrada(s) — nunca contactadas.\n`);
  }

  // Aprovação na folha: só envia os leads que o humano marcou "Aprovado p/ envio".
  let aprovados: Set<string> | null = null;
  if (opts.soAprovados) {
    try {
      aprovados = await carregarAprovados();
    } catch (e) {
      console.error(`✖ ${(e as Error).message}`);
      process.exitCode = 3;
      return;
    }
    console.log(`✅ Aprovados na folha: ${aprovados.size} lead(s) marcados para envio.\n`);
    if (aprovados.size === 0) {
      console.log("Nenhum lead está aprovado na folha. Marca o checkbox 'Aprovado p/ envio' e volta a correr.");
      return;
    }
  }

  const rows = parseCsv(fs.readFileSync(resumoPath, "utf-8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iUrl = col("url");
  const iEmail = col("email");
  const iPdf = col("relatorio_cliente_pdf");
  const iEmailFile = strategy === "coldcall" ? col("email_coldcall") : col("email_outreach");
  const iEstado = col("estado");
  const iCriticos = col("criticos");
  const iAltos = col("altos");

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
  let saltadosElegibilidade = 0;
  let saltadosSupressao = 0;
  let saltadosNaoAprovado = 0;
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
    const criticos = iCriticos >= 0 ? parseInt(row[iCriticos] || "0", 10) || 0 : 0;
    const altos = iAltos >= 0 ? parseInt(row[iAltos] || "0", 10) || 0 : 0;

    if (estado !== "ok") continue;
    // Aprovação (folha) tem prioridade: com --so-aprovados só envia os leads
    // marcados, e a aprovação do humano dispensa a regra de elegibilidade
    // automática. Sem aprovação, aplica a elegibilidade normal.
    if (aprovados) {
      if (!aprovados.has(dominioDeUrl(url))) {
        saltadosNaoAprovado++;
        continue;
      }
    } else if (!opts.incluirTodos && !valeAPenaContactar(criticos, altos)) {
      saltadosElegibilidade++;
      continue;
    }
    if (!email) {
      semEmail++;
      continue;
    }
    // Opt-out: nunca contactar quem está na lista de supressão (mesmo com --incluir-todos).
    if (estaSuprimido(supressao, url, email)) {
      saltadosSupressao++;
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
      for (const ponto of extrairPontos(body)) {
        console.log(`            • ${ponto}`);
      }
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
      `${saltadosElegibilidade} saltados por elegibilidade (${MOTIVO_NAO_ELEGIVEL}), ` +
      `${aprovados ? `${saltadosNaoAprovado} saltados por não aprovados na folha, ` : ""}` +
      `${saltadosSupressao} saltados por opt-out (lista de supressão), ` +
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
