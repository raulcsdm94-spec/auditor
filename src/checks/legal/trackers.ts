import { RegisteredCheck, Finding, CrawlResult } from "../../types";

const SUFIXOS_COMPOSTOS = new Set([
  "co.uk", "org.uk", "com.br", "com.pt", "com.es", "co.jp", "com.au",
]);

function registavel(host: string): string {
  const h = host.replace(/^www\./i, "").toLowerCase();
  const p = h.split(".");
  if (p.length <= 2) return h;
  const u2 = p.slice(-2).join(".");
  return SUFIXOS_COMPOSTOS.has(u2) ? p.slice(-3).join(".") : u2;
}

interface Tracker {
  re: RegExp;
  nome: string;
  eua: boolean;
}

/** Serviços de tracking conhecidos e se enviam dados para os EUA. */
const TRACKERS: Tracker[] = [
  { re: /google-analytics\.com|googletagmanager\.com|analytics\.google\.com/i, nome: "Google Analytics / Tag Manager", eua: true },
  { re: /doubleclick\.net|googlesyndication\.com|googleadservices\.com/i, nome: "Google Ads / DoubleClick", eua: true },
  { re: /facebook\.net|connect\.facebook|facebook\.com\/tr/i, nome: "Meta / Facebook Pixel", eua: true },
  { re: /clarity\.ms/i, nome: "Microsoft Clarity", eua: true },
  { re: /hotjar\.com/i, nome: "Hotjar", eua: false },
  { re: /analytics\.tiktok|tiktok\.com\/i18n|ttq/i, nome: "TikTok Pixel", eua: true },
  { re: /snap\.licdn\.com|px\.ads\.linkedin/i, nome: "LinkedIn Insight", eua: true },
  { re: /hubspot\.com|hs-scripts\.com|hs-analytics/i, nome: "HubSpot", eua: true },
  { re: /cdn\.segment\.com|segment\.io/i, nome: "Segment", eua: true },
];

/**
 * Analisa pedidos de rede a domínios de terceiros (trackers/analytics) e
 * sinaliza transferências de dados para fora da UE (RGPD/ePrivacy/Schrems II).
 * Usa os pedidos já recolhidos pelo crawler — análise passiva.
 */
const check: RegisteredCheck = {
  id: "legal.trackers",
  categoria: "legal",
  titulo: "Trackers de terceiros e transferência internacional de dados",
  run(crawl: CrawlResult): Finding[] {
    let hostPagina: string;
    try {
      hostPagina = new URL(crawl.finalUrl).host;
    } catch {
      return [];
    }
    const primeiraParte = registavel(hostPagina);

    const terceiros = new Map<string, string>(); // domínio registável -> exemplo de URL
    for (const r of crawl.requests) {
      let u: URL;
      try {
        u = new URL(r.url);
      } catch {
        continue;
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      const reg = registavel(u.host);
      if (!reg || reg === primeiraParte) continue;
      if (!terceiros.has(reg)) terceiros.set(reg, r.url);
    }

    if (terceiros.size === 0) {
      return [
        {
          id: "legal.trackers.ok",
          categoria: "legal",
          severidade: "info",
          descricao: "Não foram detetados pedidos a domínios de terceiros.",
        },
      ];
    }

    const urls = crawl.requests.map((r) => r.url);
    const detetados = TRACKERS.filter((t) => urls.some((u) => t.re.test(u)));
    const eua = detetados.filter((t) => t.eua);
    const findings: Finding[] = [];

    findings.push({
      id: "legal.trackers.terceiros",
      categoria: "legal",
      severidade: "medio",
      descricao:
        `${terceiros.size} domínio(s) de terceiros carregados nas páginas analisadas` +
        (detetados.length
          ? `, incluindo ${detetados.length} serviço(s) de tracking conhecido(s).`
          : "."),
      evidencia:
        Array.from(terceiros.keys()).slice(0, 12).join(", ") +
        (detetados.length ? `\nTracking: ${detetados.map((t) => t.nome).join(", ")}` : ""),
      remediacao:
        "Carregar serviços de terceiros apenas após consentimento e rever a necessidade de cada um (RGPD/ePrivacy).",
    });

    if (eua.length) {
      findings.push({
        id: "legal.trackers.eua",
        categoria: "legal",
        severidade: "medio",
        descricao: `Dados de visitantes são enviados para serviços sediados nos EUA (${eua
          .map((t) => t.nome)
          .join(", ")}), constituindo transferência internacional de dados.`,
        remediacao:
          "Avaliar a base legal da transferência (RGPD/Schrems II) e garantir consentimento e informação adequados.",
      });
    }

    return findings;
  },
};

export default check;
