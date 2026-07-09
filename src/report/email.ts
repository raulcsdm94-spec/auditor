import { CrawlResult, Finding } from "../types";
import { semTravessoes } from "./client-report";
import { detetarPerfilNegocio, PerfilNegocio } from "./business-profile";

/**
 * Gera um email de outreach PERSONALIZADO (para copiar e colar), com base no
 * que a auditoria encontrou. Escreve na mesma pasta do relatório.
 *
 * Estilo: intro da VERIS + pontos em bullets curtos (problema + porquê breve),
 * fáceis de ler. Só factos reais e mensuráveis (segurança, RGPD, tempo de
 * carregamento, servidor). Sem juízos subjetivos (ex. cores/design). Sem em dashes.
 */

function dominio(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./i, "");
  } catch {
    return u;
  }
}

function tem(findings: Finding[], id: string): boolean {
  return findings.some((f) => f.id === id);
}

function temPrefixo(findings: Finding[], prefixo: string): boolean {
  return findings.some((f) => f.id.startsWith(prefixo) && f.severidade !== "info");
}

/** Bullets curtos e personalizados, por ordem de impacto (só factos reais). */
function bullets(crawl: CrawlResult, findings: Finding[]): string[] {
  const b: string[] = [];

  if (crawl.loadTimeMs && crawl.loadTimeMs > 2500) {
    const s = (crawl.loadTimeMs / 1000).toFixed(1).replace(".", ",");
    b.push(`O site demora cerca de ${s}s a carregar (a Google recomenda menos de 2,5s)`);
  }
  if (!crawl.tls.isHttps) {
    b.push("Site sem HTTPS (sinal de insegurança para visitantes e para a Google)");
  }
  if (tem(findings, "legal.politica-privacidade.missing")) {
    b.push("Sem Política de Privacidade (obrigatória no RGPD)");
  }
  if (
    tem(findings, "legal.banner-cookies.tracking-sem-consentimento") ||
    tem(findings, "legal.banner-cookies.missing")
  ) {
    b.push("Cookies de tracking a disparar antes de consentimento (dos pontos mais fiscalizados no RGPD)");
  }
  if (tem(findings, "sec.email.dmarc-missing")) {
    b.push("Sem proteção DMARC no email (permite a qualquer pessoa falsificar emails em vosso nome)");
  }
  if (tem(findings, "legal.livro-reclamacoes.missing")) {
    b.push("Livro de Reclamações eletrónico não encontrado (obrigatório para prestadores de serviços)");
  }
  const server = crawl.headers["server"];
  if (server && /\d/.test(server)) {
    b.push(`O servidor revela a versão do software (${server}) (facilita ataques a falhas conhecidas)`);
  }
  if (tem(findings, "legal.politica-cookies.missing")) {
    b.push("Sem Política de Cookies (exigida pelo RGPD)");
  }
  if (!/<meta[^>]+name=["']viewport["']/i.test(crawl.html)) {
    b.push("Sem viewport para telemóvel (prejudica a leitura em mobile)");
  }
  if (b.length < 3 && temPrefixo(findings, "sec.headers.")) {
    b.push("Faltam headers de segurança básicos que protegem os visitantes");
  }

  if (b.length === 0) {
    b.push("Alguns pontos de segurança e conformidade que vale a pena rever");
  }
  return b;
}

/** Frase extra (uma só), quando há um achado crítico, para destacar o pior. */
const CRITICO_FRASE: Record<string, string> = {
  "sec.tls.no-https":
    "Há um ponto que classificámos como crítico e que seria o primeiro a resolver: o site ainda não usa HTTPS, o que hoje é um sinal claro de insegurança para quem visita e vos penaliza na Google.",
  "legal.politica-privacidade.missing":
    "Há um ponto que classificámos como crítico e que seria o primeiro a resolver: a ausência de Política de Privacidade, que é uma obrigação central do RGPD.",
  "sec.tls.cert-expirado":
    "Há um ponto que classificámos como crítico e que seria o primeiro a resolver: o certificado de segurança do site está expirado, o que faz os browsers mostrarem avisos de perigo aos visitantes.",
};

function fraseCritico(findings: Finding[]): string | null {
  const crit = findings.find((f) => f.severidade === "critico");
  if (!crit) return null;
  if (CRITICO_FRASE[crit.id]) return CRITICO_FRASE[crit.id];
  if (crit.id.startsWith("sec.login-forms.http")) {
    return "Há um ponto que classificámos como crítico e que seria o primeiro a resolver: o formulário de login envia os dados sem encriptação, o que expõe as credenciais de quem entra.";
  }
  return "Há um desses pontos que classificámos como crítico e que seria o primeiro que sugeríamos resolver.";
}

/** Devolve o conteúdo do ficheiro de email (assunto + corpo, texto simples). */
export function gerarEmailOutreach(crawl: CrawlResult, findings: Finding[]): string {
  const dom = dominio(crawl.finalUrl);
  const url = crawl.requestedUrl;
  const lista = bullets(crawl, findings).slice(0, 5);
  const critico = fraseCritico(findings);

  const assunto = `Encontrámos algo no site da ${dom} que acho que devem saber`;

  const corpo = [
    "Boa tarde,",
    "",
    "Sou o Raul Dantas, analista de segurança na VERIS. O nosso trabalho é ajudar negócios a conhecer riscos de segurança e RGPD que possam passar despercebidos no seu próprio site, e a corrigi-los. Guiamo-nos por uma regra: ajudar primeiro, sempre.",
    "",
    `Esta semana decidimos fazer auditoria a alguns websites, e o ${url} foi um deles. Vamos explicar o que isso quer dizer, e o que pode ser feito a seguir.`,
    "",
    "Deixo-vos abaixo o que encontramos e que vale a pena ter em atenção:",
    ...lista.map((p) => `• ${p}`),
    "",
    ...(critico ? [critico, ""] : []),
    "Nada disto compromete o site hoje, mas são pontos que preferimos que conheçam antes que sejam encontrados por outra pessoa. Está tudo explicado no relatório em anexo, que é vosso, sem compromisso.",
    "",
    "Se fizer sentido, estou disponível para uma chamada a explicar o que encontramos e como resolver. Basta responder a este email.",
    "",
    "Com os melhores cumprimentos,",
  ].join("\n");

  return semTravessoes([`Assunto: ${assunto}`, "", corpo, ""].join("\n"));
}
