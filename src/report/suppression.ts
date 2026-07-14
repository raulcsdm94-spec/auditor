import * as fs from "fs";
import * as path from "path";

/**
 * Lista de supressão (opt-out): negócios que NUNCA devem ser contactados,
 * mesmo que voltem a aparecer num CSV de leads. É o mecanismo que honra a linha
 * de opt-out dos emails ("responder com 'remover'"): quando alguém pede para
 * sair, acrescenta-se aqui a linha e o envio deixa de o incluir para sempre.
 *
 * Formato do ficheiro `_supressao.txt` (um por linha; `#` = comentário):
 *   info@exemplo.pt        ← email exato
 *   exemplo.pt             ← domínio inteiro (apanha qualquer email @exemplo.pt e o próprio site)
 *
 * Procura-se o ficheiro tanto na pasta dos relatórios como na pasta-mãe do
 * projeto (ao lado do leads.csv), e junta-se o conteúdo das duas.
 */

const NOME_FICHEIRO = "_supressao.txt";

export interface Supressao {
  /** Entradas normalizadas (emails e domínios), em minúsculas. */
  entradas: Set<string>;
  /** Nº de entradas carregadas (para logs). */
  tamanho: number;
}

/** Extrai o domínio (sem `www.`) de um email ou URL. Devolve "" se não der. */
export function dominioDe(valor: string): string {
  const v = valor.trim().toLowerCase();
  if (!v) return "";
  if (v.includes("@")) return v.slice(v.lastIndexOf("@") + 1).replace(/^www\./, "");
  try {
    const u = new URL(v.includes("://") ? v : `http://${v}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return v.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
  }
}

/** Carrega a lista de supressão a partir de `dir` e da sua pasta-mãe. */
export function carregarSupressao(dir: string): Supressao {
  const candidatos = [
    path.join(dir, NOME_FICHEIRO),
    path.join(path.dirname(dir), NOME_FICHEIRO),
  ];
  const entradas = new Set<string>();
  for (const ficheiro of candidatos) {
    if (!fs.existsSync(ficheiro)) continue;
    const linhas = fs.readFileSync(ficheiro, "utf-8").split(/\r?\n/);
    for (const raw of linhas) {
      const linha = raw.replace(/#.*$/, "").trim().toLowerCase();
      if (!linha) continue;
      // Guarda a linha como está (email ou domínio) e também o domínio derivado,
      // para apanhar tanto "info@x.pt" como "x.pt".
      entradas.add(linha.replace(/^https?:\/\//, "").replace(/^www\./, ""));
      const dom = dominioDe(linha);
      if (dom) entradas.add(dom);
    }
  }
  return { entradas, tamanho: entradas.size };
}

/**
 * Este lead está suprimido? Verdadeiro se o email exato, o domínio do email, ou
 * o domínio do site constarem da lista.
 */
export function estaSuprimido(sup: Supressao, url: string, email: string): boolean {
  if (sup.entradas.size === 0) return false;
  const e = email.trim().toLowerCase();
  const alvos = [e, dominioDe(e), dominioDe(url)].filter(Boolean);
  return alvos.some((a) => sup.entradas.has(a));
}
