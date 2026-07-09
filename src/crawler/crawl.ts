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

const USER_AGENT =
  "Mozilla/5.0 (compatible; website-auditor/0.1; +autorizado-pela-consultoria)";

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
    const response = await page.goto(opts.url, {
      waitUntil: "domcontentloaded",
      timeout,
    });
    const loadTimeMs = Date.now() - t0;

    // Pequena espera para banners de cookies / scripts que definem cookies.
    await page.waitForTimeout(2500).catch(() => {});

    const finalUrl = page.url();
    const statusCode = response ? response.status() : null;
    const headers = normalizeHeaders(response ? await response.allHeaders() : {});

    // ---- TLS (resposta do documento principal) ----
    const tls = await extractTls(response, finalUrl);

    // ---- Evidência da página principal ----
    let html = await page.content();
    let visibleText = (await page.evaluate(() => document.body?.innerText || "")).toLowerCase();
    const forms: DetectedForm[] = await extractForms(page);
    const a11y = await extractA11y(page);

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
    const maxPages = opts.maxPages ?? 5;
    if (maxPages > 1) {
      const candidatos = await extrairLinksInternos(page, finalUrl, maxPages - 1);
      for (const link of candidatos) {
        try {
          await page.goto(link, { waitUntil: "domcontentloaded", timeout });
          await page.waitForTimeout(1200).catch(() => {});
          html += `\n\n<!-- ${link} -->\n` + (await page.content());
          visibleText +=
            "\n" + (await page.evaluate(() => document.body?.innerText || "")).toLowerCase();
          forms.push(...(await extractForms(page)));
          paginasVisitadas.push(page.url());
        } catch (e) {
          warnings.push(`Falha ao visitar ${link}: ${(e as Error).message}`);
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
      dns,
      a11y,
      screenshotPath,
      warnings,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
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
      const KW = [
        "privac", "cookie", "termo", "term", "legal", "contact", "contato", "contacto",
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
        const score = KW.some((k) => hay.includes(k)) ? 1 : 0;
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
