import { RegisteredCheck, Finding, CrawlResult } from "../../types";

interface CmsSignature {
  nome: string;
  /** Padrões em HTML/headers que indicam o CMS. */
  indicios: RegExp[];
  /** Captura a versão a partir do HTML, se possível. */
  versao?: (html: string, headers: Record<string, string>) => string | undefined;
}

const ASSINATURAS: CmsSignature[] = [
  {
    nome: "WordPress",
    indicios: [/wp-content\//i, /wp-includes\//i, /name="generator" content="WordPress/i],
    versao: (html) => {
      const m = /name="generator" content="WordPress ([\d.]+)"/i.exec(html);
      return m?.[1];
    },
  },
  {
    nome: "Joomla",
    indicios: [/name="generator" content="Joomla/i, /\/media\/jui\//i],
    versao: (html) => /name="generator" content="Joomla! ([\d.]+)/i.exec(html)?.[1],
  },
  {
    nome: "Drupal",
    indicios: [/name="Generator" content="Drupal/i, /sites\/default\/files/i, /Drupal\.settings/],
    versao: (html) => /content="Drupal ([\d.]+)/i.exec(html)?.[1],
  },
  {
    nome: "Magento",
    indicios: [/static\/version\d+/i, /Mage\.Cookies/i, /mage\/cookies/i],
  },
  {
    nome: "PrestaShop",
    indicios: [/prestashop/i, /var prestashop/i],
  },
  {
    nome: "Shopify",
    indicios: [/cdn\.shopify\.com/i, /Shopify\.theme/i],
  },
  {
    nome: "Wix",
    indicios: [/static\.wixstatic\.com/i, /X-Wix-/i],
  },
];

/** Versões mínimas consideradas "atuais" (heurística simples e conservadora). */
const VERSAO_MINIMA: Record<string, [number, number]> = {
  WordPress: [6, 0],
  Joomla: [4, 0],
  Drupal: [10, 0],
};

function versaoAntiga(nome: string, versao: string): boolean {
  const min = VERSAO_MINIMA[nome];
  if (!min) return false;
  const partes = versao.split(".").map((n) => parseInt(n, 10));
  const maj = partes[0] || 0;
  const minor = partes[1] || 0;
  if (maj < min[0]) return true;
  if (maj === min[0] && minor < min[1]) return true;
  return false;
}

/**
 * Identifica o CMS/plataforma a partir de meta tags, caminhos e headers,
 * e sinaliza versões antigas. Não interroga endpoints de versão — apenas
 * analisa o HTML e headers já recolhidos.
 */
const check: RegisteredCheck = {
  id: "sec.fingerprint",
  categoria: "seguranca",
  titulo: "Fingerprinting de CMS/plataforma e deteção de versões antigas",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];
    const html = crawl.html;

    // Header X-Powered-By / Server expõe tecnologia
    for (const h of ["x-powered-by", "server"]) {
      const v = crawl.headers[h];
      if (v && /\d/.test(v)) {
        findings.push({
          id: `sec.fingerprint.header.${h}`,
          categoria: "seguranca",
          severidade: "info",
          descricao: `O header "${h}" revela tecnologia e versão do servidor.`,
          evidencia: `${h}: ${v}`,
          remediacao: "Remover ou ofuscar headers que expõem versões de software.",
        });
      }
    }

    for (const sig of ASSINATURAS) {
      const detetado = sig.indicios.some((re) => re.test(html));
      if (!detetado) continue;

      const versao = sig.versao?.(html, crawl.headers);
      const antiga = versao ? versaoAntiga(sig.nome, versao) : false;

      findings.push({
        id: `sec.fingerprint.cms.${sig.nome.toLowerCase()}`,
        categoria: "seguranca",
        severidade: antiga ? "alto" : "info",
        descricao: antiga
          ? `${sig.nome} detetado numa versão potencialmente desatualizada (${versao}).`
          : `${sig.nome} detetado${versao ? ` (versão ${versao})` : ""}.`,
        evidencia: versao ? `Versão exposta: ${versao}` : "Identificado por padrões de HTML.",
        remediacao: antiga
          ? "Atualizar o CMS e os plugins para a versão estável mais recente."
          : "Considerar ocultar a meta tag generator que expõe a versão.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: "sec.fingerprint.indeterminado",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Não foi possível identificar o CMS/plataforma por padrões conhecidos.",
      });
    }

    return findings;
  },
};

export default check;
