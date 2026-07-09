import * as fs from "fs";

/** Um alvo a auditar, com metadados opcionais vindos do scraper/CSV. */
export interface AlvoInput {
  url: string;
  email?: string;
  nome?: string;
}

/** Parser CSV mínimo com suporte a campos entre aspas e vírgulas internas. */
export function parseCsv(texto: string): string[][] {
  const linhas: string[][] = [];
  let campo = "";
  let linha: string[] = [];
  let dentroAspas = false;

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (dentroAspas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"';
          i++;
        } else {
          dentroAspas = false;
        }
      } else {
        campo += ch;
      }
    } else if (ch === '"') {
      dentroAspas = true;
    } else if (ch === ",") {
      linha.push(campo);
      campo = "";
    } else if (ch === "\n") {
      linha.push(campo);
      linhas.push(linha);
      linha = [];
      campo = "";
    } else if (ch !== "\r") {
      campo += ch;
    }
  }
  if (campo.length > 0 || linha.length > 0) {
    linha.push(campo);
    linhas.push(linha);
  }
  return linhas.filter((l) => l.some((c) => c.trim() !== ""));
}

const RE_URL = /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ehUrl(s: string): boolean {
  const t = s.trim();
  return RE_URL.test(t) && !RE_EMAIL.test(t);
}
function ehEmail(s: string): boolean {
  return RE_EMAIL.test(s.trim());
}

/**
 * Lê um CSV (ex. do scraper) e extrai website + email + nome por linha.
 * Deteta as colunas por cabeçalho; se não houver cabeçalho, procura em cada
 * célula o que parece um URL / email.
 */
export function lerCsv(caminho: string): AlvoInput[] {
  const rows = parseCsv(fs.readFileSync(caminho, "utf-8"));
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const temHeader =
    header.some((h) => /(site|website|url|web|dom[ií]nio|e-?mail|mail|nome|name|empresa)/.test(h)) &&
    !header.some(ehUrl);

  let urlIdx = -1;
  let emailIdx = -1;
  let nomeIdx = -1;
  let dados = rows;
  if (temHeader) {
    urlIdx = header.findIndex((h) => /(website|site|url|web|dom[ií]nio)/.test(h));
    emailIdx = header.findIndex((h) => /(e-?mail|mail)/.test(h));
    nomeIdx = header.findIndex((h) => /(nome|name|empresa|business)/.test(h));
    dados = rows.slice(1);
  }

  const alvos: AlvoInput[] = [];
  const vistos = new Set<string>();
  for (const row of dados) {
    let url = urlIdx >= 0 ? (row[urlIdx] || "").trim() : "";
    if (!url || !ehUrl(url)) {
      const f = row.find(ehUrl);
      url = f ? f.trim() : "";
    }
    if (!url) continue;

    let email = emailIdx >= 0 ? (row[emailIdx] || "").trim() : "";
    if (!email || !ehEmail(email)) {
      const f = row.find(ehEmail);
      email = f ? f.trim() : "";
    }
    const nome = nomeIdx >= 0 ? (row[nomeIdx] || "").trim() : "";

    const chave = url.toLowerCase().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    alvos.push({ url, email: email || undefined, nome: nome || undefined });
  }
  return alvos;
}

/** Ficheiro de texto com um URL por linha (ignora linhas vazias e `#`). */
export function lerLista(caminho: string): AlvoInput[] {
  return fs
    .readFileSync(caminho, "utf-8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((url) => ({ url }));
}

/** Argumento `--urls` com URLs separados por vírgula ou espaço. */
export function parseUrlsArg(arg: string): AlvoInput[] {
  return arg
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}
