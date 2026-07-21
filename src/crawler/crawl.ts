import { chromium, Browser, Request as PWRequest } from "playwright";
import { promises as dnsp } from "dns";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import {
  CrawlResult,
  CapturedCookie,
  CapturedRequest,
  DetectedForm,
  PathProbe,
  TlsInfo,
  DnsInfo,
  A11yInfo,
  PaginaCapturada,
} from "../types";

/**
 * Caminhos públicos bem conhecidos que NÃO deviam estar acessíveis.
 * Fazemos apenas um GET passivo a cada um e registamos o status — sem
 * brute-force, sem wordlists, sem exploração ativa.
 */
const EXPOSURE_PATHS = [
  "/.env",
  "/.git/config",
  "/wp-config.php.bak",
  "/wp-config.php~",
  "/.DS_Store",
  "/backup.zip",
  "/admin/",
  "/wp-admin/",
  "/phpmyadmin/",
  "/server-status",
];

// UA de um Chrome real: muitos WAFs servem uma página de "desafio" (ou conteúdo
// diferente) a user-agents que parecem bots. Para a auditoria refletir o que um
// visitante real vê — e evitar falsos positivos — apresentamo-nos como um browser
// normal. O acesso continua a ser passivo (um simples GET a páginas públicas).
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

/**
 * Deteta páginas de "desafio"/interstitial de proteção anti-bot (Cloudflare,
 * DDoS-Guard, etc.), em que NÃO estamos a ver o site real. Auditar estas páginas
 * geraria falsos positivos (tudo — políticas, cookies, reclamações — aparece
 * "em falta"), por isso o crawl deve ser abortado. Devolve o motivo, ou null.
 */
function motivoBloqueio(
  title: string,
  visibleText: string,
  html: string,
  statusCode: number | null,
  numLinks: number
): string | null {
  const TITULOS =
    /um momento,? por favor|one moment|just a moment|checking your browser|please wait|verifying you are (?:a )?human|attention required|acesso negado|access denied|ddos-guard/i;
  if (TITULOS.test(title)) return `página de desafio anti-bot ("${title.trim()}")`;

  const h = html.toLowerCase();
  const assinaturaWAF =
    /ddos-guard|cf-browser-verification|challenge-platform|__cf_chl|cdn-cgi\/challenge|_incapsula_|imperva/i.test(h);
  const paginaVazia = numLinks === 0 && visibleText.replace(/\s+/g, " ").trim().length < 200;
  if (assinaturaWAF && paginaVazia) return "página de desafio anti-bot (WAF)";
  if ((statusCode === 403 || statusCode === 503) && paginaVazia) {
    return `acesso bloqueado (HTTP ${statusCode})`;
  }
  return null;
}

export interface CrawlOptions {
  url: string;
  /**
   * Diretório onde guardar o screenshot temporário. Se omitido, usa o
   * diretório temporário do SO; o gerador de relatório copia-o depois para
   * a pasta final do relatório.
   */
  outDir?: string;
  timeoutMs?: number;
  /** Desativar captura de screenshot. */
  noScreenshot?: boolean;
  /** Nº máximo de páginas a carregar (principal + subpáginas). Default 5. */
  maxPages?: number;
  /** Desativar a resolução DNS (segurança de email/domínio). */
  noDns?: boolean;
}

/** Normaliza headers para chaves minúsculas. */
function normalizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/**
 * Carrega a página num browser headless e recolhe todo o material de prova
 * (HTML, headers, cookies, rede, TLS, formulários, sondagens passivas).
 */
export async function crawl(opts: CrawlOptions): Promise<CrawlResult> {
  const timeout = opts.timeoutMs ?? 30_000;
  const warnings: string[] = [];
  const requests: CapturedRequest[] = [];

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      ignoreHTTPSErrors: true, // não falhar o crawl; reportamos o problema TLS como finding
    });
    const page = await context.newPage();

    page.on("request", (req: PWRequest) => {
      requests.push({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      });
    });

    const t0 = Date.now();
    let response = await page.goto(opts.url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    const loadTimeMs = Date.now() - t0;

    // Pequena espera para banners de cookies / scripts que definem cookies e,
    // já agora, para redirecionamentos por JavaScript (location = ...), que o
    // page.url() abaixo já reflete.
    await page.waitForTimeout(2500).catch(() => {});

    // Segue redirecionamentos por <meta http-equiv="refresh">, que o goto não
    // segue sozinho. Ex.: domínios que reencaminham para a "página mãe"
    // (caso taberna-do-paco.pt). Até 2 saltos, para não entrar em ciclos.
    for (let hop = 0; hop < 2; hop++) {
      const alvo = await proximoMetaRefresh(page);
      if (!alvo) break;
      try {
        const r = await page.goto(alvo, { waitUntil: "domcontentloaded", timeout });
        if (r) response = r;
        await page.waitForTimeout(1500).catch(() => {});
      } catch (e) {
        warnings.push(`Falha ao seguir redirecionamento para ${alvo}: ${(e as Error).message}`);
        break;
      }
    }

    const finalUrl = page.url();
    const statusCode = response ? response.status() : null;
    const headers = normalizeHeaders(response ? await response.allHeaders() : {});

    // ---- TLS (resposta do documento principal) ----
    const tls = await extractTls(response, finalUrl);

    // ---- Evidência da página principal ----
    let html = await page.content();
    let visibleText = (await page.evaluate(() => document.body?.innerText || "")).toLowerCase();

    // ---- Barreira anti-bot (WAF/desafio)? Abortar antes de gerar falsos positivos ----
    // Se caímos numa página de "desafio" não estamos a ver o site real; qualquer
    // check legal daria "em falta". Devolvemos um resultado marcado como bloqueado
    // (a auditoria trata-o como falha e não gera relatório/email).
    const pageTitle = await page.title().catch(() => "");
    const numLinks = await page
      .evaluate(() => document.querySelectorAll("a[href]").length)
      .catch(() => 0);
    const bloqueio = motivoBloqueio(pageTitle, visibleText, html, statusCode, numLinks);
    if (bloqueio) {
      return {
        requestedUrl: opts.url,
        finalUrl,
        statusCode,
        loadTimeMs,
        html,
        visibleText,
        headers,
        cookies: [],
        requests,
        tls,
        forms: [],
        pathProbes: [],
        paginasVisitadas: [finalUrl],
        processaPagamento: false,
        checkoutAlcancado: false,
        dns: { dominio: hostnameSeguro(finalUrl), mx: [], caa: [], erros: ["crawl bloqueado"] },
        a11y: {
          analisado: false,
          temTitulo: false,
          imagensTotal: 0,
          imagensSemAlt: 0,
          inputsTotal: 0,
          inputsSemNome: 0,
          botoesSemNome: 0,
          saltosHeading: 0,
        },
        bloqueado: { motivo: bloqueio },
        warnings,
      };
    }

    const forms: DetectedForm[] = await extractForms(page);
    const a11y = await extractA11y(page);
    const clickableTexts = await extractClickableTexts(page, warnings);

    // ---- Screenshot (da página principal, antes de navegar para subpáginas) ----
    let screenshotPath: string | undefined;
    if (!opts.noScreenshot) {
      try {
        const shotDir = fs.mkdtempSync(path.join(opts.outDir ?? os.tmpdir(), "wa-shot-"));
        screenshotPath = path.join(shotDir, "screenshot.png");
        await page.screenshot({ path: screenshotPath, fullPage: false });
      } catch (e) {
        warnings.push(`Falha ao capturar screenshot: ${(e as Error).message}`);
        screenshotPath = undefined;
      }
    }

    // ---- Subpáginas relevantes (políticas, contacto, login, checkout…) ----
    // Mantém o crawl passivo, só segue links internos já presentes na página.
    const paginasVisitadas = [finalUrl];
    const paginas: PaginaCapturada[] = [
      { url: finalUrl, titulo: pageTitle, visibleText },
    ];
    const maxPages = opts.maxPages ?? 5;
    if (maxPages > 1) {
      const candidatos = await extrairLinksInternos(page, finalUrl, maxPages - 1);
      for (const link of candidatos) {
        try {
          await page.goto(link, { waitUntil: "domcontentloaded", timeout });
          await page.waitForTimeout(1200).catch(() => {});
          const textoPagina = (
            await page.evaluate(() => document.body?.innerText || "")
          ).toLowerCase();
          html += `\n\n<!-- ${link} -->\n` + (await page.content());
          visibleText += "\n" + textoPagina;
          forms.push(...(await extractForms(page)));
          paginasVisitadas.push(page.url());
          paginas.push({
            url: page.url(),
            titulo: await page.title().catch(() => ""),
            visibleText: textoPagina,
          });
        } catch (e) {
          warnings.push(`Falha ao visitar ${link}: ${(e as Error).message}`);
        }
      }
    }

    // ---- Segunda passagem: páginas de políticas ainda não visitadas ----
    // A Política de Cookies muitas vezes só está ligada a partir do rodapé de
    // OUTRA subpágina (ex.: da própria Política de Privacidade), pelo que não
    // aparece nos links da página principal. Vamos buscá-la também: os checks
    // legais analisam o CONTEÚDO destas páginas (qualidade, cobertura).
    if ((opts.maxPages ?? 5) > 1) {
      const extra = extrairLinksPolitica(html, finalUrl, paginasVisitadas).slice(0, 2);
      for (const link of extra) {
        try {
          await page.goto(link, { waitUntil: "domcontentloaded", timeout });
          await page.waitForTimeout(800).catch(() => {});
          const textoPagina = (
            await page.evaluate(() => document.body?.innerText || "")
          ).toLowerCase();
          html += `\n\n<!-- ${link} -->\n` + (await page.content());
          visibleText += "\n" + textoPagina;
          paginasVisitadas.push(page.url());
          paginas.push({
            url: page.url(),
            titulo: await page.title().catch(() => ""),
            visibleText: textoPagina,
          });
        } catch (e) {
          warnings.push(`Falha ao visitar política ${link}: ${(e as Error).message}`);
        }
      }
    }

    // ---- Cookies (após todas as navegações, para apanhar os de subpáginas) ----
    const rawCookies = await context.cookies();
    const cookies: CapturedCookie[] = rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expires: c.expires,
    }));

    // ---- Sondagens passivas a caminhos públicos ----
    const pathProbes = await probePaths(context, finalUrl, warnings);

    // ---- DNS (segurança de email/domínio: SPF, DMARC, MX, CAA) ----
    const dns = opts.noDns
      ? {
          dominio: hostnameSeguro(finalUrl),
          mx: [],
          caa: [],
          erros: ["resolução DNS desativada (--no-dns)"],
        }
      : await resolverDns(hostnameSeguro(finalUrl), warnings);

    await context.close();

    // ---- Sinais de pagamento online e de página de checkout alcançada ----
    // Usados pelos checks legais para só concluírem que faltam termos de
    // cancelamento/reembolso quando (a) o site processa mesmo pagamento e (b)
    // conseguimos chegar à página de checkout/pagamento onde tal apareceria.
    const processaPagamento = detetarPagamentoOnline(html, requests);
    const checkoutAlcancado =
      processaPagamento ||
      paginasVisitadas.some((u) =>
        /checkout|carrinho|\bcart\b|pagamento|payment|finaliz/i.test(u)
      );

    return {
      requestedUrl: opts.url,
      finalUrl,
      statusCode,
      loadTimeMs,
      html,
      visibleText,
      headers,
      cookies,
      requests,
      tls,
      forms,
      pathProbes,
      paginasVisitadas,
      paginas,
      processaPagamento,
      checkoutAlcancado,
      dns,
      a11y,
      clickableTexts,
      screenshotPath,
      warnings,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Devolve o URL absoluto de um redirecionamento <meta http-equiv="refresh"> na
 * página atual, ou null se não existir. Só considera refreshes imediatos ou
 * curtos (até 10s), que são de facto redirecionamentos e não "auto-reload".
 */
async function proximoMetaRefresh(
  page: import("playwright").Page
): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="refresh" i]');
      const content = meta?.getAttribute("content") || "";
      const m = content.match(/^\s*(\d+)\s*;\s*url\s*=\s*(.+?)\s*$/i);
      if (!m) return null;
      if (parseInt(m[1], 10) > 10) return null;
      let alvo = m[2].trim().replace(/^['"]|['"]$/g, "");
      try {
        alvo = new URL(alvo, location.href).href;
      } catch {
        return null;
      }
      return alvo === location.href ? null : alvo;
    });
  } catch {
    return null;
  }
}

/** Gateways de pagamento comuns (internacionais e portugueses). */
const GATEWAYS_PAGAMENTO =
  /stripe\.com|js\.stripe|checkout\.stripe|paypal|paypalobjects|braintree|\badyen\b|mollie|klarna|ifthenpay|eupago|easypay|hipay|redunicre|\bunicre\b|\bsibs\b|mbway|multibanco|lusopay|pagaqui|viva\s*wallet|vivawallet/i;

/**
 * O site processa pagamento online no próprio site? Sinal forte: um gateway de
 * pagamento nos pedidos de rede/HTML, ou campos de cartão de crédito num
 * formulário. (Reservas sem pagamento online devolvem false.)
 */
function detetarPagamentoOnline(html: string, requests: CapturedRequest[]): boolean {
  const urls = requests.map((r) => r.url).join("\n");
  if (GATEWAYS_PAGAMENTO.test(urls) || GATEWAYS_PAGAMENTO.test(html)) return true;
  return /autocomplete=["']?cc-number|name=["'][^"']*card[-_]?number|n[uú]mero\s+do\s+cart[aã]o|\bcvv\b|\bcvc\b/i.test(
    html
  );
}

async function extractTls(
  response: Awaited<ReturnType<import("playwright").Page["goto"]>>,
  finalUrl: string
): Promise<TlsInfo> {
  const isHttps = finalUrl.startsWith("https://");
  const tls: TlsInfo = { isHttps };
  if (!response) return tls;
  try {
    const sec = await response.securityDetails();
    if (sec) {
      // securityDetails() devolve um objeto de propriedades, não métodos.
      tls.protocol = sec.protocol ?? undefined;
      tls.issuer = sec.issuer ?? undefined;
      tls.subjectName = sec.subjectName ?? undefined;
      tls.validFrom = sec.validFrom ?? undefined;
      tls.validTo = sec.validTo ?? undefined;
    }
  } catch {
    /* securityDetails não disponível (ex. http) */
  }
  return tls;
}

async function extractForms(page: import("playwright").Page): Promise<DetectedForm[]> {
  const raw = await page.evaluate(() => {
    const base = location.href;
    return Array.from(document.querySelectorAll("form")).map((f) => {
      const action = f.getAttribute("action") || "";
      let resolved = action;
      try {
        resolved = new URL(action || base, base).href;
      } catch {
        resolved = base;
      }
      const hasPassword = !!f.querySelector('input[type="password"]');
      const text = (f.innerText || "").toLowerCase();
      const authHint =
        hasPassword ||
        /login|entrar|sign in|registar|criar conta|sign up|password|palavra-passe/.test(
          text
        );
      return {
        action,
        resolvedAction: resolved,
        method: (f.getAttribute("method") || "get").toLowerCase(),
        isAuthLike: authHint,
        hasPasswordField: hasPassword,
      };
    });
  });
  return raw as DetectedForm[];
}

/**
 * Faz um GET passivo a cada caminho conhecido e regista o status code.
 * Usa a API de request do contexto (não navega), e nunca segue padrões de
 * descoberta/brute-force — é uma lista fixa e curta de URLs públicas.
 */
async function probePaths(
  context: import("playwright").BrowserContext,
  finalUrl: string,
  warnings: string[]
): Promise<PathProbe[]> {
  const origin = new URL(finalUrl).origin;
  const results: PathProbe[] = [];

  for (const p of EXPOSURE_PATHS) {
    const url = origin + p;
    try {
      const res = await context.request.get(url, {
        timeout: 10_000,
        maxRedirects: 0,
        failOnStatusCode: false,
      });
      let snippet: string | undefined;
      if (res.status() === 200) {
        const body = await res.text().catch(() => "");
        snippet = body.slice(0, 200);
      }
      results.push({ path: p, url, status: res.status(), bodySnippet: snippet });
    } catch (e) {
      results.push({ path: p, url, status: null, error: (e as Error).message });
    }
  }

  if (results.every((r) => r.status === null)) {
    warnings.push("Todas as sondagens de caminhos falharam (rede/timeout?).");
  }
  return results;
}

/**
 * Recolhe os textos dos elementos clicáveis (botões, links, [role=button],
 * inputs de submissão) da página principal — em TODOS os frames e atravessando
 * shadow DOM abertos (várias CMPs, como a Usercentrics, montam o banner num
 * shadow root, invisível a um querySelectorAll normal). É corrido DEPOIS da
 * espera pós-load, quando o banner de cookies já está renderizado.
 *
 * Isto permite ao check do banner distinguir um botão "Rejeitar" real de uma
 * simples menção no texto ("pode recusar os cookies…"), que não é uma opção.
 */
async function extractClickableTexts(
  page: import("playwright").Page,
  warnings: string[]
): Promise<string[]> {
  const todos = new Set<string>();
  for (const frame of page.frames()) {
    try {
      const textos = await frame.evaluate(() => {
        const out: string[] = [];
        const SELETOR =
          'button, a[href], [role="button"], input[type="button"], input[type="submit"]';
        const recolher = (root: Document | ShadowRoot) => {
          for (const el of Array.from(root.querySelectorAll(SELETOR))) {
            const valor =
              el instanceof HTMLInputElement ? el.value : (el as HTMLElement).innerText || "";
            const texto = (valor || el.getAttribute("aria-label") || "")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            // Só rótulos curtos: um botão/link de ação tem poucas palavras; um
            // parágrafo inteiro dentro de um <a> não é um rótulo de ação.
            if (texto && texto.length <= 80) out.push(texto);
          }
          for (const el of Array.from(root.querySelectorAll("*"))) {
            if (el.shadowRoot) recolher(el.shadowRoot);
          }
        };
        recolher(document);
        return out;
      });
      for (const t of textos) todos.add(t);
    } catch {
      /* frame cross-origin inacessível ou destruído; ignorar */
    }
  }
  if (todos.size === 0) {
    warnings.push("Nenhum elemento clicável extraído (página vazia ou falha de leitura).");
  }
  return Array.from(todos);
}

/** Recolhe métricas de acessibilidade do DOM da página principal. */
async function extractA11y(page: import("playwright").Page): Promise<A11yInfo> {
  try {
    const m = await page.evaluate(() => {
      const lang = document.documentElement.getAttribute("lang") || undefined;
      const temTitulo = !!(document.title && document.title.trim());
      const imgs = Array.from(document.querySelectorAll("img"));
      const imagensSemAlt = imgs.filter((i) => !i.hasAttribute("alt")).length;
      const campos = Array.from(
        document.querySelectorAll(
          "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea"
        )
      );
      const temNome = (el: Element): boolean => {
        if (el.getAttribute("aria-label")) return true;
        if (el.getAttribute("aria-labelledby")) return true;
        if (el.getAttribute("title")) return true;
        const id = el.getAttribute("id");
        if (id) {
          try {
            const esc = (window as unknown as { CSS: { escape(s: string): string } }).CSS.escape(id);
            if (document.querySelector(`label[for="${esc}"]`)) return true;
          } catch {
            /* CSS.escape indisponível */
          }
        }
        return !!el.closest("label");
      };
      const inputsSemNome = campos.filter((el) => !temNome(el)).length;
      const botoes = Array.from(document.querySelectorAll("button, [role=button]"));
      const botoesSemNome = botoes.filter(
        (b) =>
          !(b.textContent || "").trim() &&
          !b.getAttribute("aria-label") &&
          !b.getAttribute("title")
      ).length;
      const niveis = Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
        parseInt(h.tagName.substring(1), 10)
      );
      let saltos = 0;
      let anterior = 0;
      for (const n of niveis) {
        if (anterior && n > anterior + 1) saltos++;
        anterior = n;
      }
      return {
        analisado: true,
        htmlLang: lang,
        temTitulo,
        imagensTotal: imgs.length,
        imagensSemAlt,
        inputsTotal: campos.length,
        inputsSemNome,
        botoesSemNome,
        saltosHeading: saltos,
      };
    });
    return m as A11yInfo;
  } catch {
    return {
      analisado: false,
      temTitulo: false,
      imagensTotal: 0,
      imagensSemAlt: 0,
      inputsTotal: 0,
      inputsSemNome: 0,
      botoesSemNome: 0,
      saltosHeading: 0,
    };
  }
}

/**
 * Extrai links internos relevantes da página principal, priorizando páginas
 * de políticas/legal/contacto/login. Apenas mesma origem; nunca descobre URLs.
 */
async function extrairLinksInternos(
  page: import("playwright").Page,
  finalUrl: string,
  limite: number
): Promise<string[]> {
  if (limite <= 0) return [];
  try {
    const links = await page.evaluate((base: string) => {
      const origin = new URL(base).origin;
      // Páginas de políticas (cookies/privacidade) têm prioridade máxima: os
      // checks legais analisam o CONTEÚDO dessas páginas, por isso têm de
      // caber no orçamento de subpáginas antes de contactos/login/etc.
      const KW_PRIORITARIAS = ["cookie", "privac", "rgpd", "dados-pessoais"];
      const KW = [
        "termo", "term", "legal", "contact", "contato", "contacto",
        "sobre", "about", "reclama", "politic", "policy", "conta", "login", "entrar",
        "checkout", "carrinho", "cart", "reserva", "book", "devolu", "reembol", "refund",
      ];
      const vistos = new Set<string>();
      const out: { href: string; score: number }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const raw = a.getAttribute("href") || "";
        let u: URL;
        try {
          u = new URL(raw, base);
        } catch {
          continue;
        }
        if (u.origin !== origin) continue;
        if (u.protocol !== "http:" && u.protocol !== "https:") continue;
        u.hash = "";
        const href = u.href;
        if (href === base || vistos.has(href)) continue;
        vistos.add(href);
        const hay = (u.pathname + " " + (a.textContent || "")).toLowerCase();
        const score = KW_PRIORITARIAS.some((k) => hay.includes(k))
          ? 2
          : KW.some((k) => hay.includes(k))
          ? 1
          : 0;
        out.push({ href, score });
      }
      out.sort((a, b) => b.score - a.score);
      return out.map((o) => o.href);
    }, finalUrl);
    return links.slice(0, limite);
  } catch {
    return [];
  }
}

/**
 * Extrai do HTML acumulado os hrefs de páginas de política (cookies,
 * privacidade, RGPD) da mesma origem que ainda não foram visitadas.
 */
function extrairLinksPolitica(html: string, base: string, visitadas: string[]): string[] {
  let hostBase: string;
  try {
    hostBase = new URL(base).hostname.replace(/^www\./i, "");
  } catch {
    return [];
  }
  const normaliza = (u: string) => u.replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
  const vistos = new Set(visitadas.map(normaliza));
  const out: string[] = [];
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = m[1];
    if (!/cooki|privac|gdpr|rgpd/i.test(raw)) continue;
    // Excluir recursos (CSS/JS/imagens…) e diretórios de assets: um
    // "cookieblocker.min.css" de um plugin NÃO é uma página de política.
    if (/\.(css|js|mjs|json|png|jpe?g|svg|gif|webp|ico|woff2?|xml|txt|pdf)(\?|$)/i.test(raw))
      continue;
    if (/wp-content|wp-includes|\/assets?\/|\/static\/|\/cdn-cgi\//i.test(raw)) continue;
    let u: URL;
    try {
      u = new URL(raw, base);
    } catch {
      continue;
    }
    // Mesmo domínio, tolerando www./apex (ex.: site em www.exemplo.pt com a
    // política ligada como exemplo.pt/cookies/).
    if (u.hostname.replace(/^www\./i, "") !== hostBase) continue;
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    u.hash = "";
    const chave = normaliza(u.href);
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    out.push(u.href);
  }
  return out;
}

/** Hostname seguro a partir de um URL (sem lançar). */
function hostnameSeguro(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
}

/** Sufixos públicos de segundo nível conhecidos (heurística curta). */
const SUFIXOS_COMPOSTOS = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk",
  "com.br", "com.pt", "org.pt", "gov.pt",
  "com.es", "com.au", "co.jp",
]);

/** Domínio registável (eTLD+1) a partir de um hostname, de forma heurística. */
function dominioRegistavel(host: string): string {
  const h = host.replace(/^www\./i, "").toLowerCase();
  const partes = h.split(".");
  if (partes.length <= 2) return h;
  const ultimos2 = partes.slice(-2).join(".");
  if (SUFIXOS_COMPOSTOS.has(ultimos2)) return partes.slice(-3).join(".");
  return ultimos2;
}

/** Resolve registos DNS relevantes para segurança de email/domínio. */
async function resolverDns(host: string, warnings: string[]): Promise<DnsInfo> {
  const dominio = dominioRegistavel(host);
  const info: DnsInfo = { dominio, mx: [], caa: [], erros: [] };
  const comTimeout = <T>(p: Promise<T>, ms = 5000): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);

  // MX (servidores de email)
  try {
    const mx = await comTimeout(dnsp.resolveMx(dominio));
    info.mx = mx
      .sort((a, b) => a.priority - b.priority)
      .map((m) => `${m.exchange} (prio ${m.priority})`);
  } catch {
    /* sem MX */
  }

  // SPF (TXT do domínio começado por v=spf1)
  try {
    const txt = await comTimeout(dnsp.resolveTxt(dominio));
    const flat = txt.map((parts) => parts.join(""));
    const spf = flat.find((t) => /^v=spf1/i.test(t));
    if (spf) info.spf = spf;
  } catch (e) {
    info.erros.push(`TXT: ${(e as Error).message}`);
  }

  // DMARC (TXT em _dmarc.<dominio>)
  try {
    const txt = await comTimeout(dnsp.resolveTxt(`_dmarc.${dominio}`));
    const flat = txt.map((parts) => parts.join(""));
    const dmarc = flat.find((t) => /^v=DMARC1/i.test(t));
    if (dmarc) info.dmarc = dmarc;
  } catch {
    /* sem DMARC */
  }

  // CAA (autoridades autorizadas a emitir certificados)
  try {
    const caa = await comTimeout(dnsp.resolveCaa(dominio));
    info.caa = caa.map((c) =>
      c.issue
        ? `issue ${c.issue}`
        : c.issuewild
        ? `issuewild ${c.issuewild}`
        : c.iodef
        ? `iodef ${c.iodef}`
        : JSON.stringify(c)
    );
  } catch {
    /* sem CAA */
  }

  if (!info.mx.length && !info.spf && !info.dmarc && info.caa.length === 0) {
    warnings.push(`Resolução DNS de ${dominio} sem resultados (rede/timeout?).`);
  }
  return info;
}
