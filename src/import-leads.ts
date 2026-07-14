#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { parseCsv } from "./inputs";
import { carregarSupressao, estaSuprimido, dominioDe } from "./report/suppression";

/**
 * Importa o output do scraper (Extractor/emails.csv — `website;email;city;category`,
 * separado por ';' e com BOM) para o leads.csv (`websites,emails`) do projeto,
 * acrescentando SÓ os leads novos.
 *
 * Faz dedup contra:
 *   • o próprio leads.csv (não repetir o que já lá está)
 *   • _sent-log.json      (já contactámos → não voltar a incluir)
 *   • _supressao.txt      (opt-out / bounce → nunca contactar)
 *
 * Por omissão só faz PREVIEW (mostra o que acrescentaria). Com --apply escreve
 * mesmo no leads.csv. Assim um negócio já contactado ou removido nunca reentra
 * por causa de uma raspagem nova.
 */

interface ImportOpts {
  from: string;
  leads: string;
  out: string;
  apply: boolean;
}

interface SentLogEntry {
  url: string;
  email: string;
  sentAt: string;
}

/** Normaliza um URL para chave de comparação: sem protocolo, sem www, sem barra final. */
function chaveUrl(u: string): string {
  return u
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

/** Lê um CSV que pode usar ';' ou ',' e ter BOM; devolve linhas de células. */
function lerCsvFlex(caminho: string): string[][] {
  let texto = fs.readFileSync(caminho, "utf-8");
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1); // tira BOM
  const primeira = texto.split(/\r?\n/, 1)[0] || "";
  // Deteta o delimitador pelo cabeçalho (o scraper usa ';').
  if (primeira.includes(";") && !primeira.includes(",")) {
    return texto
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "")
      .map((l) => l.split(";").map((c) => c.trim()));
  }
  return parseCsv(texto);
}

interface LinhaScraper {
  website: string;
  email: string;
}

/** Extrai website+email do output do scraper (deteta colunas pelo cabeçalho). */
function lerScraper(caminho: string): LinhaScraper[] {
  const rows = lerCsvFlex(caminho);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iWeb = header.findIndex((h) => /(website|site|url|web|dom[ií]nio)/.test(h));
  const iEmail = header.findIndex((h) => /(e-?mail|mail)/.test(h));
  const temHeader = iWeb >= 0 || iEmail >= 0;
  const dados = temHeader ? rows.slice(1) : rows;
  const out: LinhaScraper[] = [];
  for (const row of dados) {
    const website = (iWeb >= 0 ? row[iWeb] : row[0] || "").trim();
    const email = (iEmail >= 0 ? row[iEmail] || "" : row[1] || "").trim();
    if (website) out.push({ website, email });
  }
  return out;
}

function csvCampo(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function main() {
  const program = new Command();
  const AUDITOR_DIR = path.resolve(__dirname, "..");
  program
    .name("veris-import-leads")
    .description("Importa o output do scraper para o leads.csv, sem duplicar já-contactados nem suprimidos.")
    .option("--from <ficheiro>", "CSV do scraper (website;email;…)", path.join(AUDITOR_DIR, "Extractor", "emails.csv"))
    .option("--leads <ficheiro>", "leads.csv de destino", path.join(AUDITOR_DIR, "VERIS Auto Mail Project", "leads.csv"))
    .option("--out <dir>", "pasta dos relatórios (onde está o _sent-log.json)")
    .option("--apply", "escreve mesmo no leads.csv (sem isto só faz preview)", false)
    .parse(process.argv);
  const opts = program.opts<ImportOpts>();

  const fromPath = path.resolve(process.cwd(), opts.from);
  const leadsPath = path.resolve(process.cwd(), opts.leads);
  const projetoDir = path.dirname(leadsPath);
  const reportsDir = opts.out ? path.resolve(process.cwd(), opts.out) : path.join(projetoDir, "reports");

  if (!fs.existsSync(fromPath)) {
    console.error(`✖ Não encontrei o output do scraper: ${fromPath}`);
    process.exitCode = 3;
    return;
  }

  // 1) Leads que entram (do scraper).
  const novos = lerScraper(fromPath);

  // 2) Chaves já existentes, separadas por origem para o motivo do skip ser exato.
  const leadsUrls = new Set<string>();
  const leadsEmails = new Set<string>();
  if (fs.existsSync(leadsPath)) {
    for (const l of lerScraper(leadsPath)) {
      if (l.website) leadsUrls.add(chaveUrl(l.website));
      if (l.email) leadsEmails.add(l.email.toLowerCase());
    }
  }

  const sentUrls = new Set<string>();
  const sentEmails = new Set<string>();
  const sentLogPath = path.join(reportsDir, "_sent-log.json");
  if (fs.existsSync(sentLogPath)) {
    try {
      const log = JSON.parse(fs.readFileSync(sentLogPath, "utf-8")) as Record<string, SentLogEntry>;
      for (const e of Object.values(log)) {
        if (e.url) sentUrls.add(chaveUrl(e.url));
        if (e.email) sentEmails.add(e.email.toLowerCase());
      }
    } catch {
      /* log ilegível: ignora */
    }
  }

  const supressao = carregarSupressao(reportsDir);

  // 3) Triagem.
  const aAdicionar: LinhaScraper[] = [];
  let jaNoLeads = 0;
  let jaContactado = 0;
  let suprimidos = 0;
  let semEmail = 0;
  const vistosNestaCorrida = new Set<string>();

  for (const l of novos) {
    const chave = chaveUrl(l.website);
    const email = l.email.toLowerCase();

    if (vistosNestaCorrida.has(chave)) continue; // duplicado dentro do próprio scraper
    if (leadsUrls.has(chave) || (email && leadsEmails.has(email))) {
      jaNoLeads++; // já está no leads.csv
      continue;
    }
    if (sentUrls.has(chave) || (email && sentEmails.has(email))) {
      jaContactado++; // já foi contactado (sent-log)
      continue;
    }
    if (estaSuprimido(supressao, l.website, l.email)) {
      suprimidos++;
      continue;
    }
    if (!l.email) semEmail++;

    vistosNestaCorrida.add(chave);
    aAdicionar.push(l);
  }

  console.log(`📥 Scraper:  ${fromPath}  (${novos.length} linha(s))`);
  console.log(`📄 Leads:    ${leadsPath}`);
  console.log(`🚫 Supressão: ${supressao.tamanho} entrada(s)\n`);
  console.log(
    `Resultado: ${aAdicionar.length} novo(s) a acrescentar` +
      ` · ${jaNoLeads} já no leads.csv` +
      ` · ${jaContactado} já contactados (sent-log)` +
      ` · ${suprimidos} suprimidos (opt-out/bounce)` +
      `${semEmail ? ` · ${semEmail} sem email (auditáveis, não enviáveis)` : ""}.`
  );

  if (aAdicionar.length) {
    console.log("\nNovos leads:");
    for (const l of aAdicionar.slice(0, 20)) {
      console.log(`   • ${l.website}${l.email ? `  <${l.email}>` : "  (sem email)"}`);
    }
    if (aAdicionar.length > 20) console.log(`   … e mais ${aAdicionar.length - 20}.`);
  }

  if (!opts.apply) {
    console.log("\n(Preview.) Corre com --apply para acrescentar estes leads ao leads.csv.");
    return;
  }

  if (aAdicionar.length === 0) {
    console.log("\nNada novo para acrescentar. leads.csv fica igual.");
    return;
  }

  const existe = fs.existsSync(leadsPath);
  const conteudoAtual = existe ? fs.readFileSync(leadsPath, "utf-8") : "";
  const precisaHeader = !existe || conteudoAtual.trim() === "";
  const prefixo = existe && conteudoAtual.length > 0 && !conteudoAtual.endsWith("\n") ? "\n" : "";
  const linhas = aAdicionar.map((l) => `${csvCampo(l.website)},${csvCampo(l.email)}`);
  const bloco = (precisaHeader ? "websites,emails\n" : "") + linhas.join("\n") + "\n";
  fs.mkdirSync(projetoDir, { recursive: true });
  fs.appendFileSync(leadsPath, prefixo + bloco, "utf-8");
  console.log(`\n✔ ${aAdicionar.length} lead(s) acrescentado(s) a ${leadsPath}`);
  console.log("Próximo passo: npm run automail  (preview) e depois -- --send.");
}

main();
