import { RegisteredCheck, Finding, CrawlResult, PaginaCapturada } from "../../types";
import { detetarBannerCookies, encontrarPadrao, semAcentos } from "./_shared";

/**
 * Verifica a presença — e a QUALIDADE — da Política de Privacidade e da
 * Política de Cookies:
 *
 * 1. Presença de cada política (como antes, por padrões no site inteiro).
 * 2. Políticas "misturadas": muitos sites tratam os cookies dentro da Política
 *    de Privacidade em vez de terem página dedicada. Isso conta como
 *    informação prestada (não é um "sem política de cookies").
 * 3. Qualidade da Política de Cookies dedicada: o dever de transparência
 *    (Lei n.º 41/2004, art. 5.º; RGPD, arts. 12.º e 13.º) exige informação
 *    COMPLETA — que cookies, finalidades, prazos, terceiros e como gerir.
 *    Uma página de 2–3 linhas não cumpre; é sinalizada como incompleta.
 * 4. Cruzamento com a realidade: se o site INSTALA cookies e não presta
 *    qualquer informação, o incumprimento é concreto (não teórico); se não
 *    instala cookies nenhuns, a falta de política de cookies não é infração.
 */

/** URL de recurso (CSS/JS/imagem/asset) que nunca é uma página de política. */
function ehRecurso(url: string): boolean {
  return (
    /\.(css|js|mjs|json|png|jpe?g|svg|gif|webp|ico|woff2?|xml|txt|pdf)(\?|$)/i.test(url) ||
    /wp-content|wp-includes|\/assets?\/|\/static\/|\/cdn-cgi\//i.test(url)
  );
}

/** Página parece ser a Política de Cookies (pelo URL ou título)? */
function ehPaginaCookies(p: PaginaCapturada): boolean {
  if (ehRecurso(p.url)) return false;
  const url = semAcentos(p.url.toLowerCase());
  const titulo = semAcentos(p.titulo.toLowerCase());
  return (
    /cookie/.test(url) ||
    /politica de cookies|cookie policy|uso de cookies/.test(titulo)
  );
}

/** Página parece ser a Política de Privacidade (pelo URL ou título)? */
function ehPaginaPrivacidade(p: PaginaCapturada): boolean {
  const url = semAcentos(p.url.toLowerCase());
  const titulo = semAcentos(p.titulo.toLowerCase());
  return (
    /privac|rgpd|gdpr|protecao-de-dados|dados-pessoais|privacy/.test(url) ||
    /politica de privacidade|privacy policy|protecao de dados/.test(titulo)
  );
}

/**
 * Existe no HTML um LINK (mesma origem) para uma página dedicada de política
 * de cookies? Distingue uma página real de uma mera frase no texto — uma
 * menção "uso de cookies" no banner não prova que exista política.
 */
function linkPoliticaCookies(crawl: CrawlResult): string | null {
  let hostBase: string;
  try {
    hostBase = new URL(crawl.finalUrl).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
  const normaliza = (s: string) => s.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  const visitadas = new Set(crawl.paginasVisitadas.map(normaliza));
  const re = /href=["']([^"']*cooki[^"']*)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(crawl.html))) {
    if (ehRecurso(m[1])) continue;
    try {
      const u = new URL(m[1], crawl.finalUrl);
      u.hash = "";
      // Uma âncora na própria página (#cmplz-cookies-overview) ou uma página
      // já visitada não é uma "página dedicada por analisar".
      if (visitadas.has(normaliza(u.href))) continue;
      if (
        u.hostname.replace(/^www\./i, "") === hostBase &&
        (u.protocol === "http:" || u.protocol === "https:")
      ) {
        return u.href;
      }
    } catch {
      /* href inválido */
    }
  }
  return null;
}

/**
 * Elementos que uma Política de Cookies completa deve cobrir (deveres de
 * transparência da Lei n.º 41/2004 e do RGPD). Regexes sobre texto lowercase
 * e SEM acentos; cobrem PT/ES/EN.
 */
const ELEMENTOS_POLITICA_COOKIES: { nome: string; re: RegExp }[] = [
  {
    nome: "tipos de cookies usados",
    re: /tipos de cookies|cookies (?:essenciais|necessari|tecnic|de sessao|persistentes|proprios|de terceiros|analitic|funcionais|de desempenho|de marketing|de publicidade|estatistic|first.party|third.party)|(?:strictly necessary|essential|functional|analytics|performance|advertising) cookies/,
  },
  {
    nome: "finalidades",
    re: /finalidade|utilizamos? (?:os |estes )?cookies para|usamos? (?:os )?cookies para|servem para|proposito|purpose|para que (?:servem|sao) usad/,
  },
  {
    nome: "prazos/duração",
    re: /durac[a]o|prazo|validade|expira|persistem|tempo de vida|duration|expiry|expiration|caducidad/,
  },
  {
    nome: "como gerir/desativar",
    re: /desativar|desactivar|bloquear|apagar|eliminar|gerir|gestionar|configurar[^.]{0,40}(?:browser|navegador)|definicoes do (?:browser|navegador)|preferencias de cookies|disable|opt.out|manage cookies|browser settings/,
  },
  {
    nome: "cookies de terceiros",
    re: /terceiros|third[- ]party|google analytics|facebook|meta pixel|youtube|hotjar|doubleclick/,
  },
];

/** Texto "útil" da página: comprimido e sem acentos, para análise e contagem. */
function textoUtil(p: PaginaCapturada): string {
  return semAcentos(p.visibleText.replace(/\s+/g, " ").trim());
}

/**
 * Ano de "última atualização" declarado na política, se existir.
 * Só aceita anos plausíveis perto de palavras de atualização/revisão.
 */
function anoAtualizacao(texto: string): number | null {
  const m =
    texto.match(/(?:atualizad|revist|revisao|updated|vigor)[^.]{0,50}?\b(20\d{2})\b/) ||
    texto.match(/\b(20\d{2})\b[^.]{0,50}?(?:atualizad|revist|revisao|updated)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Cookies não essenciais instalados no carregamento (heurística partilhada). */
function cookiesNaoEssenciais(crawl: CrawlResult): string[] {
  return crawl.cookies
    .filter((c) =>
      /_ga|_gid|_fbp|_gcl|^fr$|(^|_)sid$|sbjs_|analytics|doubleclick|hubspot|visitor_info|^ysc$/i.test(
        c.name
      )
    )
    .map((c) => c.name);
}

const check: RegisteredCheck = {
  id: "legal.politicas",
  categoria: "legal",
  titulo: "Política de Privacidade e Política de Cookies (presença e qualidade)",
  run(crawl, ctx): Finding[] {
    const findings: Finding[] = [];
    const r = ctx.legalRules.patterns;
    const pags = crawl.paginas ?? [];

    const pagPrivacidade = pags.find(ehPaginaPrivacidade);
    const pagCookies = pags.find((p) => ehPaginaCookies(p) && !ehPaginaPrivacidade(p)) ??
      pags.find(ehPaginaCookies);

    // ---------- Política de Privacidade ----------
    const privacidade = encontrarPadrao(crawl, r.politicaPrivacidade);
    if (privacidade) {
      findings.push({
        id: "legal.politica-privacidade.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Política de Privacidade encontrada.",
        evidencia: pagPrivacidade
          ? `Correspondência: "${privacidade.match}"; página: ${pagPrivacidade.url}`
          : `Correspondência: "${privacidade.match}"`,
      });
    } else {
      findings.push({
        id: "legal.politica-privacidade.missing",
        categoria: "legal",
        severidade: "critico",
        descricao:
          "O website não apresenta uma Política de Privacidade facilmente acessível, o que incumpre o RGPD (Regulamento (UE) 2016/679, arts. 13.º e 14.º, e Lei n.º 58/2019) quanto à informação dos utilizadores sobre o tratamento dos seus dados pessoais.",
        remediacao: ctx.legalRules.remediacao.politicaPrivacidade,
      });
    }

    // ---------- Política de Cookies ----------
    const padraoCookies = encontrarPadrao(crawl, r.politicaCookies);
    const linkDedicado = linkPoliticaCookies(crawl);
    // A Política de Privacidade cobre cookies de forma substantiva?
    // (mais do que uma menção de passagem: várias ocorrências ou um dos
    // elementos de transparência presentes no texto dessa página)
    const textoPriv = pagPrivacidade ? textoUtil(pagPrivacidade) : "";
    const mencoesCookiesNaPriv = (textoPriv.match(/cookie/g) || []).length;
    const privCobreCookies =
      mencoesCookiesNaPriv >= 3 ||
      (mencoesCookiesNaPriv >= 1 &&
        ELEMENTOS_POLITICA_COOKIES.some((e) => e.re.test(textoPriv)));

    const naoEssenciais = cookiesNaoEssenciais(crawl);

    if (pagCookies) {
      // Página dedicada encontrada e analisada: avaliar a QUALIDADE.
      const texto = textoUtil(pagCookies);
      const emFalta = ELEMENTOS_POLITICA_COOKIES.filter((e) => !e.re.test(texto)).map(
        (e) => e.nome
      );
      const cobertos = ELEMENTOS_POLITICA_COOKIES.length - emFalta.length;
      const muitoCurta = texto.length < 600;
      const ano = anoAtualizacao(texto);
      const desatualizada = ano !== null && ano < 2020;

      if (muitoCurta || cobertos <= 2 || desatualizada) {
        const motivos: string[] = [];
        if (muitoCurta) motivos.push("texto muito curto (algumas linhas apenas)");
        if (cobertos <= 2 && emFalta.length > 0) {
          motivos.push(`não cobre: ${emFalta.join(", ")}`);
        }
        if (desatualizada) {
          motivos.push(
            `aparenta estar desatualizada (última atualização declarada: ${ano}, anterior às orientações da CNPD/EDPB de 2020 sobre consentimento)`
          );
        }
        findings.push({
          id: "legal.politica-cookies.incompleta",
          categoria: "legal",
          severidade: "medio",
          descricao: `Política de Cookies presente mas incompleta ou desatualizada: ${motivos.join(
            "; "
          )}.`,
          evidencia: `Página: ${pagCookies.url} (${texto.length} caracteres de texto)`,
          remediacao:
            "Completar a Política de Cookies com os tipos de cookies usados, finalidades, prazos de conservação, cookies de terceiros e instruções para os gerir/recusar, e mantê-la atualizada (Lei n.º 41/2004, art. 5.º; RGPD, arts. 12.º e 13.º).",
        });
      } else {
        findings.push({
          id: "legal.politica-cookies.ok",
          categoria: "legal",
          severidade: "info",
          descricao: "Política de Cookies encontrada e com conteúdo adequado.",
          evidencia: `Página: ${pagCookies.url}; cobre ${cobertos} de ${ELEMENTOS_POLITICA_COOKIES.length} elementos de transparência.`,
        });
      }
    } else if (linkDedicado) {
      // Há um LINK para uma página dedicada de cookies que não chegámos a
      // analisar (fora do orçamento de páginas) — existe, sem juízo de qualidade.
      findings.push({
        id: "legal.politica-cookies.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Política de Cookies encontrada.",
        evidencia: `Link para página dedicada: ${linkDedicado} (página não analisada individualmente)`,
      });
    } else if (privCobreCookies) {
      // Sem página dedicada, mas a Política de Privacidade trata os cookies —
      // prática comum e aceitável; informar sem penalizar.
      findings.push({
        id: "legal.politica-cookies.integrada",
        categoria: "legal",
        severidade: "info",
        descricao:
          "Não existe Política de Cookies dedicada, mas a informação sobre cookies está integrada na Política de Privacidade.",
        evidencia: `Página: ${pagPrivacidade!.url} (${mencoesCookiesNaPriv} menções a cookies)`,
      });
    } else if (detetarBannerCookies(crawl, r.bannerCookies)) {
      // Há banner de consentimento mas não localizámos a política (muitas vezes
      // é aberta pelo próprio banner). Não reportável como incumprimento.
      findings.push({
        id: "legal.politica-cookies.integrada",
        categoria: "legal",
        severidade: "info",
        descricao:
          "Banner de consentimento de cookies presente; não foi localizada uma Política de Cookies dedicada (poderá estar integrada na Política de Privacidade ou acessível pelo banner).",
      });
    } else if (padraoCookies) {
      // Só uma MENÇÃO textual (sem página dedicada, sem cobertura na política
      // de privacidade e sem banner). Sinal fraco, mas suficiente para não
      // acusar o site de não ter política — seria arriscado sem confirmação.
      findings.push({
        id: "legal.politica-cookies.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Referência a Política de Cookies encontrada.",
        evidencia: `Correspondência: "${padraoCookies.match}" (sem página dedicada localizada)`,
      });
    } else if (crawl.cookies.length > 0) {
      // O site INSTALA cookies e não presta qualquer informação sobre eles:
      // incumprimento concreto do dever de informação.
      const amostra = crawl.cookies.slice(0, 6).map((c) => c.name).join(", ");
      findings.push({
        id: "legal.politica-cookies.missing",
        categoria: "legal",
        severidade: "alto",
        descricao: `O site instala ${crawl.cookies.length} cookie(s)${
          naoEssenciais.length > 0
            ? `, incluindo ${naoEssenciais.length} de tracking/analytics,`
            : ""
        } mas não apresenta qualquer Política de Cookies ou informação sobre a sua utilização.`,
        evidencia: `Cookies observados: ${amostra}${crawl.cookies.length > 6 ? "…" : ""}`,
        remediacao: ctx.legalRules.remediacao.politicaCookies,
      });
    } else {
      // Sem política MAS também sem cookies detetados: não há incumprimento
      // a reportar — dizer "falta política de cookies" a um site sem cookies
      // seria um falso alarme. Fica como nota informativa.
      findings.push({
        id: "legal.politica-cookies.desnecessaria",
        categoria: "legal",
        severidade: "info",
        descricao:
          "Não foi encontrada Política de Cookies, mas também não foi detetado nenhum cookie durante o carregamento — nesta situação a política não é exigível. Se o site passar a instalar cookies, a informação torna-se obrigatória.",
      });
    }

    return findings;
  },
};

export default check;
