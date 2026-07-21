import * as fs from "fs";
import * as path from "path";

/**
 * Puxa a folha de leads PARTILHADA (Google Sheets) para um CSV local, para que
 * tu ou o cofundador possam adicionar leads na folha e um `npm run automail` os
 * apanhe sem tocar em ficheiros. A folha tem de estar partilhada como "qualquer
 * pessoa com o link: leitor" (ou Ficheiro → Publicar na Web) — aí o export CSV
 * é acessível sem login. Configura-se no .env com LEADS_SHEET_ID (o ID do URL).
 */

/** Constrói o URL de export CSV a partir de um ID puro OU de um URL completo. */
export function urlExportCsv(idOrUrl: string, gid?: string): string {
  let id = idOrUrl.trim();
  const m = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) id = m[1];
  const g = gid ? `&gid=${gid}` : "";
  return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${g}`;
}

/**
 * Descarrega a folha de leads para `destPath`. Devolve o nº de linhas de dados
 * (sem o cabeçalho), ou `null` se não houver folha configurada no .env.
 * Lança com uma mensagem clara se a folha não estiver pública.
 */
export async function pullLeadsSheet(destPath: string): Promise<number | null> {
  const idOrUrl =
    process.env.LEADS_SHEET_ID ||
    process.env.LEADS_SHEET_URL ||
    process.env.LEADS_SHEET_CSV_URL;
  if (!idOrUrl) return null;

  const url = /\/export\?/.test(idOrUrl)
    ? idOrUrl
    : urlExportCsv(idOrUrl, process.env.LEADS_SHEET_GID);

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(
      `A folha de leads devolveu HTTP ${res.status}. Confirma que está partilhada ` +
        `como "qualquer pessoa com o link: leitor".`
    );
  }
  const texto = await res.text();
  // Se voltou HTML/página de login, a folha não está pública.
  if (/^\s*</.test(texto) || /accounts\.google\.com|<\/?html/i.test(texto.slice(0, 300))) {
    throw new Error(
      `A folha de leads não está acessível publicamente. Abre-a → Partilhar → ` +
        `"Qualquer pessoa com o link: Leitor" (ou Ficheiro → Publicar na Web).`
    );
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, texto.endsWith("\n") ? texto : texto + "\n", "utf-8");

  const linhas = texto.trim().split(/\r?\n/).filter((l) => l.trim() !== "");
  return Math.max(0, linhas.length - 1); // menos o cabeçalho
}
