import { RegisteredCheck, Finding, CrawlResult, CapturedCookie, Severidade } from "../../types";

/**
 * Verifica as flags de segurança dos cookies definidos pelo site:
 * Secure, HttpOnly e SameSite.
 *
 * Três princípios para evitar falsos alarmes que minam a credibilidade:
 *
 * 1. Só cookies PRÓPRIOS (first-party). As flags de um cookie de terceiros
 *    (ex.: YouTube embebido) são definidas por esse terceiro — o dono do site
 *    não as pode corrigir.
 * 2. A severidade depende do TIPO de cookie. Só um cookie de sessão/autenticação
 *    permite "sequestro de sessão"; num cookie de analytics/preferências
 *    (sbjs_*, _ga, cmplz_*…) as mesmas flags em falta são risco menor. Além
 *    disso, cookies definidos por JavaScript nunca podem ter HttpOnly, por isso
 *    essa flag só é exigida a cookies de sessão (caso casadoavohoracio.pt, em
 *    que 8 cookies sbjs_* geraram 8 "graves" repetidos).
 * 3. Cookies com os MESMOS problemas são agrupados num único finding — um
 *    relatório com 8 entradas iguais parece gerado às cegas.
 */

/** Cookies de sessão/autenticação, onde as flags são realmente críticas. */
const RE_COOKIE_SESSAO = /sess(ion|id)?|auth|token|login|logged|passw|(^|[_-])sid([_-]|$)/i;

/**
 * Cookies de analytics/atribuição CONHECIDOS cujo nome inclui "session"/"ses"
 * mas que NÃO são cookies de sessão de autenticação (são definidos por JS e
 * nunca poderiam ter HttpOnly): Sourcebuster (sbjs_session), Hotjar
 * (_hjSession…), Matomo (_pk_ses…), Google/Meta, Mixpanel, Segment.
 * Têm precedência sobre RE_COOKIE_SESSAO.
 */
const RE_COOKIE_ANALITICO =
  /^(sbjs_|_ga|_gid|_gat|_gcl|_fbp|_hj|_pk_|mp_|ajs_|amplitude|cmplz|moove_gdpr|cky|cookieyes)/i;

/** É um cookie de sessão/autenticação "a sério"? */
function ehCookieSessao(nome: string): boolean {
  return !RE_COOKIE_ANALITICO.test(nome) && RE_COOKIE_SESSAO.test(nome);
}

/** O cookie pertence ao próprio site (ou a um subdomínio dele)? */
function ehPrimeiraParte(c: CapturedCookie, siteHost: string): boolean {
  const cd = c.domain.replace(/^\./, "").toLowerCase();
  const sh = siteHost.replace(/^www\./, "").toLowerCase();
  return cd === sh || cd.endsWith("." + sh) || sh.endsWith("." + cd);
}

/** Lista curta de nomes para a descrição: até 6, depois "e mais N". */
function listarNomes(nomes: string[]): string {
  const mostrar = nomes.slice(0, 6).map((n) => `"${n}"`);
  const resto = nomes.length - mostrar.length;
  return resto > 0 ? `${mostrar.join(", ")} e mais ${resto}` : mostrar.join(", ");
}

interface Grupo {
  problemas: string[];
  severidade: Severidade;
  sessao: boolean;
  cookies: CapturedCookie[];
}

const check: RegisteredCheck = {
  id: "sec.cookies",
  categoria: "seguranca",
  titulo: "Flags de segurança dos cookies (Secure/HttpOnly/SameSite)",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];

    if (crawl.cookies.length === 0) {
      findings.push({
        id: "sec.cookies.nenhum",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Nenhum cookie foi definido durante o carregamento da página.",
      });
      return findings;
    }

    let siteHost = "";
    try {
      siteHost = new URL(crawl.finalUrl).hostname;
    } catch {
      siteHost = "";
    }
    const proprios = siteHost
      ? crawl.cookies.filter((c) => ehPrimeiraParte(c, siteHost))
      : crawl.cookies;
    const nTerceiros = crawl.cookies.length - proprios.length;

    const grupos = new Map<string, Grupo>();

    for (const c of proprios) {
      const sessao = ehCookieSessao(c.name);
      const problemas: string[] = [];
      if (crawl.tls.isHttps && !c.secure) problemas.push("sem flag Secure");
      // HttpOnly e SameSite só são exigíveis a cookies de sessão: cookies
      // definidos por JS (analytics, preferências) não podem ter HttpOnly,
      // e o risco de CSRF do SameSite só existe em cookies de sessão.
      if (sessao && !c.httpOnly) problemas.push("sem flag HttpOnly");
      const sameSite = (c.sameSite || "").toLowerCase();
      if (sessao && (!sameSite || sameSite === "none")) {
        problemas.push(`SameSite=${c.sameSite || "ausente"}`);
      }

      if (problemas.length === 0) continue;

      // Cookie de sessão sem Secure/HttpOnly é grave (sequestro de sessão);
      // tudo o resto é médio.
      const severidade: Severidade =
        sessao && (problemas.includes("sem flag Secure") || problemas.includes("sem flag HttpOnly"))
          ? "alto"
          : "medio";

      const chave = `${sessao ? "sessao" : "gerais"}|${problemas.join(",")}`;
      const g = grupos.get(chave);
      if (g) g.cookies.push(c);
      else grupos.set(chave, { problemas, severidade, sessao, cookies: [c] });
    }

    for (const g of grupos.values()) {
      const nomes = g.cookies.map((c) => c.name);
      const tipo = g.sessao ? "de sessão " : "";
      const descricao =
        nomes.length === 1
          ? `Cookie ${tipo}"${nomes[0]}" com configuração de segurança fraca: ${g.problemas.join(", ")}.`
          : `${nomes.length} cookies ${tipo}(${listarNomes(nomes)}) com configuração de segurança fraca: ${g.problemas.join(", ")}.`;
      findings.push({
        id: `sec.cookies.flags.${g.sessao ? "sessao" : "gerais"}.${g.problemas
          .join("-")
          .replace(/[^a-z0-9]+/gi, "-")
          .toLowerCase()}`,
        categoria: "seguranca",
        severidade: g.severidade,
        descricao,
        evidencia: g.cookies
          .map((c) => `${c.name} (domínio=${c.domain}; secure=${c.secure}; httpOnly=${c.httpOnly}; sameSite=${c.sameSite})`)
          .join("; "),
        risco: g.sessao
          ? "Cookies de sessão sem as flags de segurança corretas podem ser intercetados ou lidos por scripts maliciosos, permitindo o sequestro da sessão do utilizador."
          : "Sem a flag Secure, estes cookies podem ser transmitidos por ligações não cifradas e lidos por terceiros na rede. Não sendo cookies de sessão, o impacto é limitado, mas a correção é simples e recomendada.",
        remediacao:
          "Definir Secure (em HTTPS) em todos os cookies e, nos cookies de sessão, HttpOnly e SameSite=Lax/Strict.",
      });
    }

    if (findings.length === 0) {
      const nota =
        nTerceiros > 0
          ? ` (${nTerceiros} cookie(s) de terceiros não avaliados: as suas flags não são controláveis pelo site)`
          : "";
      findings.push({
        id: "sec.cookies.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao: `Todos os ${proprios.length} cookie(s) próprios têm flags de segurança adequadas${nota}.`,
      });
    }

    return findings;
  },
};

export default check;
