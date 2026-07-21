import { CrawlResult } from "../../types";

/** Remove acentos/diacríticos ("política" → "politica", "utilização" → "utilizacao"). */
export function semAcentos(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Procura, de forma case-insensitive E insensível a acentos, qualquer um dos
 * padrões no conteúdo da página (HTML completo + texto visível). Devolve o
 * primeiro padrão encontrado como evidência, ou null se nenhum corresponder.
 *
 * A insensibilidade a acentos evita uma classe inteira de falsos negativos:
 * um banner que diz "utilização de cookies" passa a corresponder ao padrão
 * "utilizacao de cookies" sem ser preciso listar as duas variantes.
 */
export function encontrarPadrao(
  crawl: CrawlResult,
  patterns: string[]
): { match: string } | null {
  const bruto = (crawl.html + "\n" + crawl.visibleText).toLowerCase();
  // Segunda versão do texto com separadores de URL/slug (-, _, /) trocados por
  // espaços: assim um link de rodapé como "/politica-de-cookies" ou
  // "privacidade_cookies" também corresponde ao padrão "política de cookies".
  const normalizado = bruto.replace(/[-_/]+/g, " ");
  // Terceira versão sem acentos, para casar padrões independentemente de o site
  // usar (ou não) diacríticos.
  const semAc = semAcentos(bruto);
  const semAcNorm = semAcentos(normalizado);
  for (const p of patterns) {
    const needle = p.toLowerCase();
    const needleSemAc = semAcentos(needle);
    if (
      bruto.includes(needle) ||
      normalizado.includes(needle) ||
      semAc.includes(needleSemAc) ||
      semAcNorm.includes(needleSemAc)
    ) {
      return { match: p };
    }
  }
  return null;
}

/**
 * Assinaturas (no HTML) das plataformas de gestão de consentimento (CMP) mais
 * comuns. A sua presença é um sinal forte e independente da língua de que o site
 * TEM um mecanismo de banner de cookies — mesmo que o texto do banner use uma
 * frase que não está na nossa lista de padrões. Foi exatamente esta a lacuna que
 * fez o auditor dizer, erradamente, que homegest.com.pt "não tinha banner".
 */
const ASSINATURAS_CMP: { nome: string; re: RegExp }[] = [
  { nome: "Cookiebot", re: /cybotcookiebot|cookiebot/i },
  { nome: "OneTrust", re: /onetrust|optanon|otsdkstub/i },
  { nome: "Osano cookieconsent", re: /cc-window|cc-banner|cc-btn|cookieconsent/i },
  { nome: "Complianz", re: /cmplz-|complianz/i },
  { nome: "Iubenda", re: /iubenda-cs|iubenda/i },
  { nome: "Quantcast / IAB TCF", re: /qc-cmp2|__tcfapi|quantcast-choice/i },
  { nome: "Usercentrics", re: /usercentrics/i },
  { nome: "CookieYes / GDPR Cookie Consent", re: /cookie-law-info|cli-bar|cky-consent|cookieyes/i },
  { nome: "Termly", re: /termly/i },
  { nome: "Borlabs Cookie", re: /borlabs-cookie/i },
  { nome: "Real Cookie Banner", re: /rcb-consent|real-cookie-banner/i },
  { nome: "tarteaucitron", re: /tarteaucitron/i },
  { nome: "Klaro", re: /klaro-cookie|klaro!/i },
  { nome: "Moove GDPR", re: /moove_gdpr|moove-gdpr/i },
  // Banner nativo do Squarespace: o contexto estático da página declara
  // explicitamente se o banner está ativo. Sem esta assinatura, um site
  // Squarespace com banner em texto não listado (ex.: "Selecione Aceitar
  // tudo…") era dado, erradamente, como "sem banner" (caso hyggeandhealthy.pt).
  { nome: "Squarespace", re: /"isCookieBannerEnabled"\s*:\s*true|sqs-cookie-banner/i },
  // Banners nativos de outros construtores de sites comuns, para não repetir
  // o caso hyggeandhealthy noutras plataformas.
  { nome: "Wix", re: /consentPolicyManager|consent-banner-root/i },
  { nome: "Shopify", re: /shopify-pc__banner/i },
  { nome: "CookieScript", re: /cookiescript/i },
  { nome: "Didomi", re: /didomi-host|didomi\.io/i },
  { nome: "Axeptio", re: /axeptio/i },
  { nome: "Finsweet Cookie Consent", re: /fs-cc-|fs-cc=/i },
];

/**
 * Classes/atributos dos botões de REJEITAR das CMPs conhecidas. São um sinal
 * de rejeição independente da LÍNGUA do rótulo: um botão Complianz
 * "cmplz-deny" é uma opção de rejeitar quer diga "Negar", "Rechazar" ou
 * qualquer outro texto que não esteja na nossa lista de padrões.
 */
const ASSINATURAS_BOTAO_REJEITAR: { nome: string; re: RegExp }[] = [
  { nome: "Complianz", re: /cmplz-deny/i },
  { nome: "CookieYes", re: /cky-btn-reject|cli-reject-btn|cookie_action_close_header_reject/i },
  { nome: "OneTrust", re: /onetrust-reject-all-handler|ot-pc-refuse-all-handler/i },
  { nome: "Cookiebot", re: /CybotCookiebotDialogBodyButtonDecline/i },
  { nome: "Osano cookieconsent", re: /cc-deny/i },
  { nome: "tarteaucitron", re: /tarteaucitronAllDenied/i },
  { nome: "Klaro", re: /cm-btn-decline|cn-decline/i },
  { nome: "Iubenda", re: /iubenda-cs-reject-btn/i },
  { nome: "Didomi", re: /didomi-continue-without-agreeing|button--decline/i },
  { nome: "Squarespace", re: /sqs-cookie-banner-v2-optOut/i },
];

/** Deteta um botão de rejeitar de uma CMP conhecida pela sua classe no HTML. */
export function detetarBotaoRejeitarCMP(crawl: CrawlResult): { nome: string } | null {
  for (const s of ASSINATURAS_BOTAO_REJEITAR) {
    if (s.re.test(crawl.html)) return { nome: s.nome };
  }
  return null;
}

/** Deteta uma CMP conhecida pela sua assinatura no HTML. */
export function detetarCMP(crawl: CrawlResult): { nome: string } | null {
  const h = crawl.html;
  for (const s of ASSINATURAS_CMP) {
    if (s.re.test(h)) return { nome: s.nome };
  }
  return null;
}

/**
 * Deteta a presença de um banner de consentimento de cookies por QUALQUER um de
 * dois sinais: (1) uma frase típica de banner no texto, ou (2) a assinatura de
 * uma CMP conhecida no HTML. Centralizar isto garante que os vários checks
 * (banner-cookies e politicas) concordam sobre se existe banner.
 */
export function detetarBannerCookies(
  crawl: CrawlResult,
  patterns: string[]
): { match: string } | null {
  const porTexto = encontrarPadrao(crawl, patterns);
  if (porTexto) return porTexto;
  const cmp = detetarCMP(crawl);
  if (cmp) return { match: `plataforma de consentimento detetada (${cmp.nome})` };
  return null;
}

/**
 * Procura os padrões apenas nos textos dos elementos CLICÁVEIS da página
 * (botões, links, [role=button]) — case- e acento-insensitive. Devolve o padrão
 * e o rótulo do elemento onde correspondeu, para evidência.
 */
export function encontrarPadraoClicavel(
  crawl: CrawlResult,
  patterns: string[]
): { match: string; elemento: string } | null {
  const textos = crawl.clickableTexts ?? [];
  for (const p of patterns) {
    const needle = semAcentos(p.toLowerCase());
    const alvo = textos.find((t) => semAcentos(t).includes(needle));
    if (alvo !== undefined) return { match: p, elemento: alvo };
  }
  return null;
}

/**
 * A opção de REJEITAR cookies tem de ser uma AÇÃO (botão/link), não uma mera
 * menção no texto: "Pode configurar ou recusar os cookies clicando em…" não é
 * uma opção de rejeição — foi exatamente este falso "ok" que escondeu o banner
 * sem rejeição do feelviana.com. Por isso procura-se só nos elementos
 * clicáveis; a pesquisa antiga na página inteira fica apenas como fallback
 * para crawls em que a extração de clicáveis falhou (lista vazia).
 */
export function encontrarRejeicaoCookies(
  crawl: CrawlResult,
  patterns: string[]
): { match: string; elemento?: string } | null {
  if (crawl.clickableTexts && crawl.clickableTexts.length > 0) {
    const porRotulo = encontrarPadraoClicavel(crawl, patterns);
    if (porRotulo) return porRotulo;
    // Rótulo não reconhecido? A classe do botão de uma CMP conhecida é um
    // sinal de rejeição independente da língua (ex.: cmplz-deny com o texto
    // "Negar"). Evita falsos "sem opção de rejeitar" por rótulos fora da lista.
    const porClasse = detetarBotaoRejeitarCMP(crawl);
    if (porClasse) return { match: `botão de rejeitar da CMP ${porClasse.nome}` };
    return null;
  }
  return encontrarPadrao(crawl, patterns);
}

/** Extrai um excerto curto à volta da primeira ocorrência, para evidência. */
export function excerto(crawl: CrawlResult, termo: string, janela = 80): string {
  const texto = crawl.visibleText || crawl.html.toLowerCase();
  const idx = texto.indexOf(termo.toLowerCase());
  if (idx < 0) return termo;
  const ini = Math.max(0, idx - janela);
  const fim = Math.min(texto.length, idx + termo.length + janela);
  return "…" + texto.slice(ini, fim).replace(/\s+/g, " ").trim() + "…";
}
