#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { parseCsv } from "./inputs";
import { parseEmailFile } from "./report/parse-email-file";
import { ASSINATURA } from "./report/signature";

/**
 * Cria um ficheiro .eml por lead a partir do resultado de uma auditoria em
 * batch (`_resumo-auditorias.csv`). Cada .eml já traz destinatário + corpo +
 * o relatório do cliente anexado, e abre no Outlook em modo de composição
 * (cabeçalho `X-Unsent: 1`), pronto a rever e Enviar à mão.
 */

interface DraftOpts {
  out: string;
}

/** RFC 2047 para assuntos com acentos. */
function encodeSubject(s: string): string {
  return `=?UTF-8?B?${Buffer.from(s, "utf-8").toString("base64")}?=`;
}

/** Parte base64 em linhas de 76 caracteres (requisito MIME). */
function wrap76(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join("\r\n");
}

/** Constrói o conteúdo MIME de um .eml (corpo texto + PDF anexado). */
function construirEml(to: string, subject: string, body: string, pdfPath: string): string {
  const boundary = "veris_" + Math.random().toString(36).slice(2);
  const corpo = body + "\n\n" + ASSINATURA.join("\n") + "\n";
  const corpoB64 = wrap76(Buffer.from(corpo, "utf-8").toString("base64"));
  const pdfB64 = wrap76(fs.readFileSync(pdfPath).toString("base64"));
  const pdfName = path.basename(pdfPath);

  return [
    `To: ${to}`,
    `Subject: ${encodeSubject(subject)}`,
    "X-Unsent: 1",
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    corpoB64,
    "",
    `--${boundary}`,
    `Content-Type: application/pdf; name="${pdfName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${pdfName}"`,
    "",
    pdfB64,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function nomeFicheiro(url: string): string {
  return (
    url
      .replace(/^https?:\/\//i, "")
      .replace(/[^\w.-]/g, "_")
      .replace(/_+$/g, "") || "lead"
  );
}

function main() {
  const program = new Command();
  program
    .name("veris-drafts")
    .description("Gera rascunhos .eml (destinatário + corpo + PDF) a partir das auditorias.")
    .option("--out <dir>", "pasta dos relatórios (onde está o _resumo-auditorias.csv)", "reports")
    .parse(process.argv);
  const opts = program.opts<DraftOpts>();

  const outDir = path.resolve(process.cwd(), opts.out);
  const resumoPath = path.join(outDir, "_resumo-auditorias.csv");
  if (!fs.existsSync(resumoPath)) {
    console.error(`✖ Não encontrei ${resumoPath}. Corre primeiro uma auditoria (npm run audit).`);
    process.exitCode = 3;
    return;
  }

  const rows = parseCsv(fs.readFileSync(resumoPath, "utf-8"));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iUrl = col("url");
  const iEmail = col("email");
  const iPdf = col("relatorio_cliente_pdf");
  const iEmailFile = col("email_outreach");
  const iEstado = col("estado");

  const outbox = path.join(outDir, "_outbox");
  fs.mkdirSync(outbox, { recursive: true });

  let feitos = 0;
  const semEmail: string[] = [];
  const semFicheiros: string[] = [];

  for (const row of rows.slice(1)) {
    const url = (row[iUrl] || "").trim();
    const email = (row[iEmail] || "").trim();
    const pdf = (row[iPdf] || "").trim();
    const emailFile = (row[iEmailFile] || "").trim();
    const estado = (row[iEstado] || "").trim();

    if (estado !== "ok") continue;
    if (!email) {
      semEmail.push(url);
      continue;
    }
    if (!pdf || !fs.existsSync(pdf) || !emailFile || !fs.existsSync(emailFile)) {
      semFicheiros.push(url);
      continue;
    }

    const { subject, body } = parseEmailFile(fs.readFileSync(emailFile, "utf-8"));
    const eml = construirEml(email, subject, body, pdf);
    fs.writeFileSync(path.join(outbox, `${nomeFicheiro(url)}.eml`), eml, "utf-8");
    feitos++;
  }

  console.log(`✔ ${feitos} rascunho(s) .eml criados em:\n  ${outbox}\n`);
  if (semEmail.length) {
    console.log(`  ${semEmail.length} sem email (ignorados): ${semEmail.slice(0, 5).join(", ")}${semEmail.length > 5 ? "…" : ""}`);
  }
  if (semFicheiros.length) {
    console.log(`  ${semFicheiros.length} sem PDF/email-outreach (ignorados).`);
  }
  console.log(
    "\nComo usar: abre a pasta _outbox e faz duplo-clique em cada .eml.\n" +
      "O Outlook abre-o já preenchido (destinatário + corpo + PDF anexado). Revê e carrega Enviar."
  );
}

main();
