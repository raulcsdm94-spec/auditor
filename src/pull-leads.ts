#!/usr/bin/env node
import * as path from "path";
import { Command } from "commander";
import { loadEnv } from "./env";
import { pullLeadsSheet } from "./leads-sheet";

/**
 * Puxa a folha de leads partilhada (Google Sheets) para o leads.csv da pasta do
 * projeto. Normalmente não é preciso correr à mão — o `npm run automail` já o faz
 * antes de auditar. Útil só para testar a ligação à folha.
 */

const DEFAULT_DIR = path.join(__dirname, "..", "VERIS Auto Mail Project");

async function main() {
  loadEnv();
  const program = new Command();
  program
    .name("veris-pull-leads")
    .description("Descarrega a folha de leads partilhada para o leads.csv local.")
    .option("--dir <pasta>", "pasta do projeto (onde fica o leads.csv)", DEFAULT_DIR)
    .option("--dest <ficheiro>", "CSV de destino (por omissão <dir>/leads.csv)")
    .parse(process.argv);
  const opts = program.opts<{ dir: string; dest?: string }>();

  const dest = opts.dest
    ? path.resolve(process.cwd(), opts.dest)
    : path.join(path.resolve(process.cwd(), opts.dir), "leads.csv");

  const n = await pullLeadsSheet(dest);
  if (n === null) {
    console.log(
      "ℹ️  LEADS_SHEET_ID não está definido no .env — nada a puxar.\n" +
        "   Mete o ID da folha de leads em LEADS_SHEET_ID (ver SHEET-TRACKER.md)."
    );
    return;
  }
  console.log(`✔ Leads atualizados da Google Sheet: ${n} lead(s) → ${dest}`);
}

main().catch((e) => {
  console.error(`✖ ${(e as Error).message}`);
  process.exitCode = 1;
});
