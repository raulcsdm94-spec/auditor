#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { parseCsv } from "./inputs";
import { parseEmailFile } from "./report/parse-email-file";
import { valeAPenaContactar } from "./report/outreach";
import { carregarSupressao, estaSuprimido, Supressao } from "./report/suppression";
import { loadEnv } from "./env";

/**
 * Espelha o `_resumo-auditorias.csv` (+ `_sent-log.json`) numa Google Sheet
 * partilhada, para o cofundador ver os dry-runs e rever os emails na SUA
 * máquina — sem paths locais. Os ficheiros (PDF do cliente, relatório completo,
 * screenshot) são carregados para uma pasta partilhada do Drive e a folha fica
 * só com links clicáveis.
 *
 * Usa o mesmo padrão do tracker da welcome page: um web-app do Apps Script
 * (SHEET_TRACKER_WEBHOOK_URL no .env) que faz o upload + upsert da linha. Não
 * precisa de login Google no CLI. É best-effort: se o webhook não estiver
 * configurado ou falhar, avisa mas nunca parte o pipeline (o CSV local continua
 * a ser a fonte de verdade).
 *
 * Corre sozinho a seguir a cada auditoria/envio via `npm run automail`, ou à
 * mão com `npm run sync`.
 */

interface SyncOpts {
  out: string;
  strategy: string;
  only?: string;
  files: boolean;
  screenshot: boolean;
  dryRun: boolean;
  limit?: string;
}

interface SentLogEntry {
  url: string;
  email: string;
  sentAt: string;
}
type SentLog = Record<string, SentLogEntry>;

/** Mesmo id estável usado pelo send.ts como chave do _sent-log.json. */
function idFicheiro(url: string): string {
  return (
    url
      .replace(/^https?:\/\//i, "")
      .replace(/[^\w.-]/g, "_")
      .replace(/_+$/g, "") || "lead"
  );
}

/** Domínio limpo (nome da subpasta no Drive + chave humana da linha). */
function dominio(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./i, "")
    .toLowerCase();
}

function lerSentLog(p: string): SentLog {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

function dataPt(d: Date): string {
  return d.toLocaleString("pt-PT", {
    timeZone: "Europe/Lisbon",
    dateStyle: "short",
    timeStyle: "short",
  });
}

interface Ficheiro {
  slot: "email" | "cliente" | "completo" | "screenshot";
  nome: string;
  mime: string;
  dataBase64: string;
}

function anexar(
  ficheiros: Ficheiro[],
  slot: Ficheiro["slot"],
  caminho: string,
  mime: string
): void {
  if (!caminho || !fs.existsSync(caminho)) return;
  ficheiros.push({
    slot,
    nome: path.basename(caminho),
    mime,
    dataBase64: fs.readFileSync(caminho).toString("base64"),
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * "Pronto a enviar?" — usa EXATAMENTE a mesma lógica do send.ts, para a folha
 * dizer a verdade sobre o que sairia num `--send` real. Devolve "Sim" ou
 * "Não (motivo)".
 */
function prontoParaEnviar(
  sup: Supressao,
  estado: string,
  criticos: number,
  altos: number,
  email: string,
  url: string,
  jaEnviado: boolean
): string {
  if (jaEnviado) return "Não (já enviado)";
  if (estado !== "ok") return `Não (auditoria: ${estado || "erro"})`;
  if (!email) return "Não (sem email)";
  if (estaSuprimido(sup, url, email)) return "Não (opt-out)";
  if (!valeAPenaContactar(criticos, altos)) return "Não (sem problemas sérios)";
  return "Sim";
}

async function main() {
  loadEnv();

  const program = new Command();
  program
    .name("veris-sync")
    .description("Espelha o resumo das auditorias numa Google Sheet partilhada (com ficheiros no Drive).")
    .option("--out <dir>", "pasta dos relatórios (onde está o _resumo-auditorias.csv)", "reports")
    .option("--strategy <tipo>", "email a mostrar na folha: 'classico' (outreach) ou 'coldcall'", "classico")
    .option("--only <texto>", "sincroniza só os leads cujo URL contém este texto")
    .option("--no-files", "não carrega ficheiros para o Drive (só atualiza contagens/estado/enviado)")
    .option("--no-screenshot", "carrega PDFs mas salta o screenshot (payload mais leve)")
    .option("--dry-run", "mostra o que seria sincronizado, sem enviar nada", false)
    .option("--limit <n>", "sincroniza no máximo N leads")
    .parse(process.argv);
  const opts = program.opts<SyncOpts>();

  const strategy = (opts.strategy || "classico").toLowerCase() === "coldcall" ? "coldcall" : "classico";

  const outDir = path.resolve(process.cwd(), opts.out);
  const resumoPath = path.join(outDir, "_resumo-auditorias.csv");
  if (!fs.existsSync(resumoPath)) {
    console.error(`✖ Não encontrei ${resumoPath}. Corre primeiro uma auditoria (npm run audit).`);
    process.exitCode = 3;
    return;
  }

  const webhook = process.env.SHEET_TRACKER_WEBHOOK_URL;
  if (!webhook && !opts.dryRun) {
    console.log(
      "ℹ️  SHEET_TRACKER_WEBHOOK_URL não está definido no .env — a saltar a sincronização com a Google Sheet.\n" +
        "   (Vê SHEET-TRACKER.md para o setup de uma vez. O _resumo-auditorias.csv local continua a ser gerado.)"
    );
    return; // best-effort: nunca parte o pipeline
  }

  const log = lerSentLog(path.join(outDir, "_sent-log.json"));
  const supressao = carregarSupressao(outDir);

  const rows = parseCsv(fs.readFileSync(resumoPath, "utf-8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iUrl = col("url");
  const iUrlFinal = col("url_final");
  const iEstado = col("estado");
  const iCriticos = col("criticos");
  const iAltos = col("altos");
  const iMedios = col("medios");
  const iEmail = col("email");
  const iPasta = col("pasta");
  const iPdf = col("relatorio_cliente_pdf");
  // O email mostrado na folha é SEMPRE o cold-call — é o que o cofundador revê.
  const iEmailFile = col("email_coldcall");
  const iErro = col("erro");

  const limit = opts.limit ? parseInt(opts.limit, 10) : Infinity;
  let ok = 0;
  let falhados = 0;
  let saltados = 0;
  let processados = 0;

  for (const row of rows.slice(1)) {
    const url = (row[iUrl] || "").trim();
    if (!url) continue;
    if (opts.only && !url.toLowerCase().includes(opts.only.toLowerCase())) {
      saltados++;
      continue;
    }
    if (processados >= limit) break;
    processados++;

    const estado = iEstado >= 0 ? (row[iEstado] || "").trim() : "";
    const pasta = iPasta >= 0 ? (row[iPasta] || "").trim() : "";
    const emailFile = iEmailFile >= 0 ? (row[iEmailFile] || "").trim() : "";
    const pdf = iPdf >= 0 ? (row[iPdf] || "").trim() : "";
    const erro = iErro >= 0 ? (row[iErro] || "").trim() : "";

    const id = idFicheiro(url);
    const enviado = log[id];

    let assunto = "";
    let emailTexto = "";
    if (emailFile && fs.existsSync(emailFile)) {
      const parsed = parseEmailFile(fs.readFileSync(emailFile, "utf-8"));
      assunto = parsed.subject;
      emailTexto = parsed.body;
    }

    const ficheiros: Ficheiro[] = [];
    if (opts.files) {
      // Rascunho do email cold-call que seria enviado — também vai para a pasta.
      anexar(ficheiros, "email", emailFile, "text/plain");
      anexar(ficheiros, "cliente", pdf, "application/pdf");
      if (pasta) {
        anexar(ficheiros, "completo", path.join(pasta, "relatorio.pdf"), "application/pdf");
        if (opts.screenshot) {
          anexar(ficheiros, "screenshot", path.join(pasta, "screenshot.png"), "image/png");
        }
      }
    }

    const dataAudit = pasta && fs.existsSync(pasta) ? dataPt(fs.statSync(pasta).mtime) : dataPt(new Date());
    const email = iEmail >= 0 ? (row[iEmail] || "").trim() : "";
    const criticos = iCriticos >= 0 ? parseInt(row[iCriticos] || "0", 10) || 0 : 0;
    const altos = iAltos >= 0 ? parseInt(row[iAltos] || "0", 10) || 0 : 0;

    const payload: Record<string, unknown> = {
      lead: dominio(url),
      url: (row[iUrlFinal] || url).trim() || url,
      data: dataAudit,
      estado: estado || "—",
      criticos,
      altos,
      medios: iMedios >= 0 ? parseInt(row[iMedios] || "0", 10) || 0 : 0,
      email,
      estrategia: strategy,
      assunto,
      emailTexto,
      prontoEnviar: prontoParaEnviar(supressao, estado, criticos, altos, email, url, !!enviado),
      emailEnviado: enviado ? "Sim" : "Não",
      dataEnvio: enviado ? dataPt(new Date(enviado.sentAt)) : "",
      notas: erro ? `Erro: ${erro}` : "",
      ficheiros,
    };

    const nFich = ficheiros.length;
    if (opts.dryRun) {
      console.log(
        `[dry-run] ${payload.lead} | estado=${payload.estado} | C${payload.criticos}/A${payload.altos}/M${payload.medios}` +
          ` | pronto=${payload.prontoEnviar} | enviado=${payload.emailEnviado} | ${nFich} ficheiro(s) | assunto="${assunto}"`
      );
      ok++;
      continue;
    }

    try {
      const res = await fetch(webhook!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let corpo: any = null;
      try {
        corpo = await res.json();
      } catch {
        /* Apps Script pode devolver HTML no redirect; ignorar */
      }
      if (res.ok && (!corpo || corpo.ok !== false)) {
        ok++;
        console.log(`✔ ${payload.lead} → folha atualizada${nFich ? ` (${nFich} ficheiro(s))` : ""}`);
      } else {
        falhados++;
        console.error(`✖ ${payload.lead} → ${corpo?.error || res.status + " " + res.statusText}`);
      }
    } catch (e) {
      falhados++;
      console.error(`✖ ${payload.lead} → ${(e as Error).message}`);
    }
    await sleep(300);
  }

  console.log(
    `\nSincronização ${opts.dryRun ? "(dry-run) " : ""}concluída: ${ok} ok` +
      `${falhados ? `, ${falhados} falhado(s)` : ""}${saltados ? `, ${saltados} fora do filtro --only` : ""}.`
  );
}

main().catch((e) => {
  console.error(`✖ Erro inesperado: ${(e as Error).message}`);
  process.exitCode = 1;
});
