import { CrawlResult, Finding, Severidade } from "../types";
import { semTravessoes } from "./client-report";
import { riscoCliente } from "./risco";
import { ROTULO_CRITICO, ROTULO_GRAVE, ROTULO_MELHORAR } from "./email-html";
import { MAX_PONTOS_COLDCALL } from "./outreach";

/**
 * Gera emails de outreach PERSONALIZADOS (para copiar e colar).
 * Duas estratégias: clássica (com relatório) ou cold call (sem anexos).
 */

const SITE = "www.verisaudit.com";

/**
 * Link da página de boas-vindas com um código único por lead (?r=<domínio>),
 * para sabermos QUEM abriu a página quando clicam no link do email.
 */
function linkWelcome(crawl: CrawlResult): string {
  let code = "";
  try {
    code = new URL(crawl.requestedUrl).hostname.replace(/^www\./, "");
  } catch {
    code = "";
  }
  const q = code ? `?r=${encodeURIComponent(code)}` : "";
  return `${SITE}/pt/welcome${q}`;
}

/**
 * Ordena achados por impacto. A SEVERIDADE manda sempre: um problema crítico
 * aparece antes de qualquer grave, e um grave antes de qualquer médio — para o
 * email (e o seu primeiro ponto) liderar com o mais crítico. Só dentro da mesma
 * severidade é que desempatamos por incumprimento legal (coimas) e depois por
 * exploits de segurança.
 */
function ordenarPorImpacto(findings: Finding[]): Finding[] {
  return findings
    .map((f) => {
      let score = 0;
      // Primário: severidade (blocos largos para nunca serem ultrapassados).
      if (f.severidade === "critico") score += 10000;
      else if (f.severidade === "alto") score += 5000;
      else if (f.severidade === "medio") score += 1000;
      // Desempate dentro da mesma severidade: legal/coimas primeiro…
      if (f.categoria === "legal") score += 100;
      // …e depois os exploits de segurança.
      if (
        f.id.includes("tls") ||
        f.id.includes("login") ||
        f.id.includes("dmarc") ||
        f.id.includes("exposure")
      ) {
        score += 50;
      }
      return { finding: f, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.finding);
}

/**
 * Pontos a mostrar no email de cold call: apenas achados SÉRIOS (crítico ou grave),
 * porque são os que representam incumprimento/risco real e que motivam o dono a agir.
 * Os "Algo a melhorar" (médio/info: acessibilidade, avisos preventivos) ficam de fora.
 *
 * No máximo MAX_PONTOS_COLDCALL. Se o site não tiver achados sérios (é saltado na
 * elegibilidade do envio), cai num fallback de médios só para o ficheiro não ficar vazio.
 */
function pontosColdCall(findings: Finding[]): Finding[] {
  const serios = ordenarPorImpacto(
    findings.filter((f) => f.severidade === "critico" || f.severidade === "alto")
  );
  const base = serios.length
    ? serios
    : ordenarPorImpacto(findings.filter((f) => f.severidade === "medio"));
  return base.slice(0, MAX_PONTOS_COLDCALL);
}

/** Rótulo curto por severidade, prefixado a cada ponto (dá também a cor do "ball" no HTML). */
const ROTULO_SEVERIDADE: Record<Severidade, string> = {
  critico: ROTULO_CRITICO,
  alto: ROTULO_GRAVE,
  medio: ROTULO_MELHORAR,
  info: ROTULO_MELHORAR,
};

/** Suaviza aberturas secas ("Não foi encontrada X" → "X") e capitaliza a 1.ª letra. */
function limparDescricao(desc: string): string {
  const limpa = desc
    .replace(/^Não (?:foi|foram) (?:encontrad|detetad)[oa]s?\s+/i, "")
    .replace(/^Não existe[m]?\s+/i, "")
    .trim();
  return limpa.charAt(0).toUpperCase() + limpa.slice(1);
}

/**
 * Findings cuja descrição já é uma frase completa e informativa; nestes não se
 * acrescenta a frase de risco, para o ponto não ficar redundante.
 */
const IDS_SEM_RISCO_EMAIL = new Set(["legal.politica-privacidade.missing"]);

/**
 * Formata um finding para o email: "<Rótulo>: <problema>. <risco>".
 * A transição problema → explicação usa ponto final (e não vírgula) para ser
 * claramente percetível. O rótulo ("Problema Crítico"/…) reflete a severidade
 * e, no HTML, colore o "ball".
 */
function formatarFinding(finding: Finding): string {
  const rotulo = ROTULO_SEVERIDADE[finding.severidade];
  const desc = limparDescricao(finding.descricao).replace(/\.$/, "");
  const risco = IDS_SEM_RISCO_EMAIL.has(finding.id) ? "" : riscoCliente(finding) || "";
  const corpo = risco ? `${desc}. ${risco}` : desc;
  return `${rotulo}: ${corpo}`;
}

/**
 * Há algum ponto "sério" (com risco real de compromisso ou coima)?
 * Qualquer crítico, ou qualquer incumprimento legal (que expõe a coimas), conta.
 */
function temProblemaSerio(findings: Finding[]): boolean {
  return findings.some(
    (f) => f.severidade === "critico" || (f.categoria === "legal" && f.severidade !== "info")
  );
}

function tem(findings: Finding[], id: string): boolean {
  return findings.some((f) => f.id === id);
}

function temPrefixo(findings: Finding[], prefixo: string): boolean {
  return findings.some((f) => f.id.startsWith(prefixo) && f.severidade !== "info");
}

/** Bullets curtos e personalizados para a versão clássica, por ordem de impacto. */
function bulletsClassico(crawl: CrawlResult, findings: Finding[]): string[] {
  const b: string[] = [];

  if (crawl.loadTimeMs && crawl.loadTimeMs > 2500) {
    const s = (crawl.loadTimeMs / 1000).toFixed(1).replace(".", ",");
    b.push(`O site demora cerca de ${s}s a carregar (a Google recomenda menos de 2,5s)`);
  }
  if (!crawl.tls.isHttps) {
    b.push("Site sem HTTPS (sinal de insegurança para visitantes e para a Google)");
  }
  if (tem(findings, "legal.politica-privacidade.missing")) {
    b.push("Sem Política de Privacidade (obrigatória no RGPD, arts. 13.º e 14.º)");
  }
  if (
    tem(findings, "legal.banner-cookies.tracking-sem-consentimento") ||
    tem(findings, "legal.banner-cookies.missing")
  ) {
    b.push("Cookies de tracking a disparar antes de consentimento (viola a Lei n.º 41/2004, art. 5.º, e o RGPD; dos pontos mais fiscalizados)");
  }
  if (tem(findings, "sec.email.dmarc-missing")) {
    b.push("Sem proteção DMARC no email (permite a qualquer pessoa falsificar emails em vosso nome)");
  }
  if (tem(findings, "legal.livro-reclamacoes.missing")) {
    b.push("Livro de Reclamações eletrónico não encontrado (obrigatório sob o DL n.º 156/2005, com coima de 150€ a 15.000€)");
  }
  const server = crawl.headers["server"];
  if (server && /\d/.test(server)) {
    b.push(`O servidor revela a versão do software (${server}) (facilita ataques a falhas conhecidas)`);
  }
  if (tem(findings, "legal.politica-cookies.missing")) {
    b.push("Sem Política de Cookies (exigida pela Lei n.º 41/2004 e pelo RGPD)");
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

/** Frase extra quando há um achado crítico, para destacar o pior. */
const CRITICO_FRASE: Record<string, string> = {
  "sec.tls.no-https":
    "Há um ponto que classificámos como crítico e que seria o primeiro a resolver: o site ainda não usa HTTPS, o que hoje é um sinal claro de insegurança para quem visita e vos penaliza na Google.",
  "legal.politica-privacidade.missing":
    "Há um ponto que classificámos como crítico e que seria o primeiro a resolver: a ausência de Política de Privacidade, que é uma obrigação central do RGPD (Regulamento (UE) 2016/679, arts. 13.º e 14.º).",
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

/**
 * Estratégia CLÁSSICA: email com relatório anexado, explicação completa.
 * Devolve o conteúdo do ficheiro de email (assunto + corpo, texto simples).
 */
export function gerarEmailOutreach(crawl: CrawlResult, findings: Finding[]): string {
  const url = crawl.requestedUrl;
  const lista = bulletsClassico(crawl, findings).slice(0, 5);
  const critico = fraseCritico(findings);

  const assunto = "Relatório: Auditoria de Segurança e Privacidade";

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
    `Se preferir, preparámos uma página que explica exatamente o que fizemos e o que pode fazer a seguir: ${linkWelcome(crawl)}`,
    "",
    "Com os melhores cumprimentos,",
  ].join("\n");

  return semTravessoes([`Assunto: ${assunto}`, "", corpo, ""].join("\n"));
}

/**
 * Estratégia COLD CALL: email curto sem anexo, bait para responder e pedir relatório.
 * Devolve o conteúdo do ficheiro de email (assunto + corpo, texto simples).
 */
export function gerarEmailOutreachColdCall(crawl: CrawlResult, findings: Finding[]): string {
  const url = crawl.requestedUrl;
  const topPontos = pontosColdCall(findings);
  const serio = temProblemaSerio(findings);

  const assunto = "Auditoria: Segurança e Conformidade do seu website";

  const pontos = topPontos.map((f) => `  • ${formatarFinding(f)}`).join("\n");

  // Frase de enquadramento: a tranquilizadora "nenhum destes pontos…" só entra
  // quando NÃO há nada sério (um crítico ou incumprimento legal já implica risco real).
  const enquadramento = serio
    ? "Isto são situações que podem afetar a segurança, a conformidade legal ou a confiança dos visitantes, e é recomendável corrigi-las de forma preventiva."
    : "Nenhum destes pontos significa, por si só, que o website esteja comprometido. Isto são situações que podem afetar a segurança, a conformidade legal ou a confiança dos visitantes, e é recomendável corrigi-las de forma preventiva.";

  const corpo = [
    "Boa tarde,",
    "",
    "O meu nome é Raul Dantas sou analista de segurança da VERIS.",
    "",
    `Estivemos a analisar o seu website ${url} e identificámos alguns pontos que consideramos relevantes e que poderão merecer atenção:`,
    "",
    pontos,
    "",
    enquadramento,
    "",
    "Se pretender receber a versão completa desta auditoria, com todos os pontos identificados e respetivas recomendações, basta responder a este email. Teremos todo o gosto em enviá-la, sem qualquer compromisso.",
    "",
    `A VERIS é uma empresa especializada em auditoria técnica de websites, segurança informática, conformidade RGPD e análise de desempenho. Preparámos uma página que explica exatamente o que fizemos e o que pode fazer a seguir: ${linkWelcome(crawl)}`,
    "",
    "Com os melhores cumprimentos,",
  ].join("\n");

  return semTravessoes([`Assunto: ${assunto}`, "", corpo, ""].join("\n"));
}
