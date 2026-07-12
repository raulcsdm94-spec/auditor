import { CrawlResult, Finding, Severidade } from "../types";
import { semTravessoes } from "./client-report";
import { detetarPerfilNegocio } from "./business-profile";
import { riscoCliente } from "./risco";
import { ROTULO_CRITICO, ROTULO_GRAVE, ROTULO_MELHORAR } from "./email-html";
import { MAX_PONTOS_COLDCALL } from "./outreach";

/**
 * Gera emails de outreach PERSONALIZADOS (para copiar e colar).
 * Duas estratégias: clássica (com relatório) ou cold call (sem anexos).
 */

/** Cidades reconhecidas: chave em minúsculas → nome de apresentação. */
const CIDADES: Record<string, string> = {
  lisboa: "Lisboa",
  porto: "Porto",
  covilhã: "Covilhã",
  braga: "Braga",
  aveiro: "Aveiro",
  viseu: "Viseu",
  guarda: "Guarda",
  "castelo branco": "Castelo Branco",
  leiria: "Leiria",
  santarém: "Santarém",
  setúbal: "Setúbal",
  évora: "Évora",
  beja: "Beja",
  faro: "Faro",
};

/** Sentinela devolvida quando há múltiplas localizações (cadeia) ou ambiguidade. */
const PORTUGAL = "Portugal";
/** Sentinela devolvida quando não é possível determinar a localização. */
const SEM_LOCAL = "sua zona";

/**
 * Extrai a cidade/localização do crawl. Estratégia:
 *  1) Prefere o formato canónico de morada "1234-567 Cidade" (fiável).
 *  2) Se isso não der, procura menções de cidades no texto.
 * Em ambos os passos, se surgir MAIS DE UMA cidade distinta (cadeia com várias
 * localizações, ou texto ambíguo) devolve "Portugal" em vez de arriscar a
 * cidade errada. Sem qualquer sinal, devolve "sua zona".
 */
function extrairLocalizacao(crawl: CrawlResult): string {
  const texto = (crawl.html + " " + crawl.visibleText).toLowerCase();

  // 1) Cidade a seguir a um código postal canónico "NNNN-NNN Localidade".
  // A captura fica pela localidade: só letras/espaços/hífen na mesma linha,
  // parando em pontuação ou dígito (não engole a frase seguinte).
  const porCodigoPostal = new Set<string>();
  const re = /\b\d{4}-\d{3}[ ]+([a-zà-ÿ][a-zà-ÿ '\-]{1,28})/gi;
  for (const m of texto.matchAll(re)) {
    const localidade = m[1];
    for (const chave of Object.keys(CIDADES)) {
      if (localidade.includes(chave)) porCodigoPostal.add(CIDADES[chave]);
    }
  }
  if (porCodigoPostal.size === 1) return [...porCodigoPostal][0];
  if (porCodigoPostal.size > 1) return PORTUGAL;

  // 2) Menções de cidades no texto. Se houver mais do que uma cidade distinta,
  // não adivinhamos (evita o clássico "em Porto" quando o negócio é de Braga).
  const mencionadas = new Set<string>();
  for (const chave of Object.keys(CIDADES)) {
    if (texto.includes(chave)) mencionadas.add(CIDADES[chave]);
  }
  if (mencionadas.size === 1) return [...mencionadas][0];
  if (mencionadas.size > 1) return PORTUGAL;

  return SEM_LOCAL;
}

/**
 * Constrói a frase de localização com a preposição correta:
 * "no Porto", "na Covilhã", "em Lisboa", "em Portugal", "na sua zona".
 */
function fraseLocalizacao(loc: string): string {
  const PREP: Record<string, string> = {
    Porto: "no Porto",
    Covilhã: "na Covilhã",
    Guarda: "na Guarda",
    Portugal: "em Portugal",
    [SEM_LOCAL]: "na sua zona",
  };
  return PREP[loc] || `em ${loc}`;
}

/** Extrai categoria de negócio em português amigável (ou "negócios" se desconhecido). */
function extrairCategoria(crawl: CrawlResult): string {
  const perfil = detetarPerfilNegocio(crawl);
  const categoriaMap: Record<string, string> = {
    alojamento: "alojamentos",
    restauracao: "restauração",
    ecommerce: "comércio online",
    servicos: "serviços",
    imobiliario: "imobiliário",
    saude: "clínicas de saúde",
    automovel: "serviço automóvel",
    desconhecido: "negócios",
  };
  return categoriaMap[perfil.perfil] || "negócios";
}

/** Ordena achados por impacto: legal/coimas > exploits de segurança > severidade. */
function ordenarPorImpacto(findings: Finding[]): Finding[] {
  return findings
    .map((f) => {
      let score = 0;
      // Incumprimento legal pesa mais (pode dar origem a coimas).
      if (f.categoria === "legal") score += 1000;
      if (f.severidade === "critico") score += 100;
      if (f.severidade === "alto") score += 50;
      if (f.severidade === "medio") score += 10;
      // Exploits de segurança.
      if (
        f.id.includes("tls") ||
        f.id.includes("login") ||
        f.id.includes("dmarc") ||
        f.id.includes("exposure")
      ) {
        score += 500;
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

/** Frase extra quando há um achado crítico, para destacar o pior. */
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
  const localizacao = extrairLocalizacao(crawl);
  const categoria = extrairCategoria(crawl);
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
    "O meu nome é Raul Dantas e sou analista de segurança da VERIS.",
    "",
    `Esta semana estivemos a analisar alguns websites de ${categoria} ${fraseLocalizacao(localizacao)} e o ${url} foi um deles.`,
    "",
    "Durante essa auditoria identificámos alguns pontos que consideramos relevantes e que poderão merecer atenção:",
    "",
    pontos,
    "",
    enquadramento,
    "",
    "Se pretender receber a versão completa desta auditoria, com todos os pontos identificados e respetivas recomendações, basta responder a este email. Teremos todo o gosto em enviá-la, sem qualquer compromisso.",
    "",
    "A VERIS é uma empresa especializada em auditoria técnica de websites, segurança informática, conformidade RGPD e análise de desempenho. Pode conhecer melhor o nosso trabalho em www.verisaudit.com.",
    "",
    "Com os melhores cumprimentos,",
  ].join("\n");

  return semTravessoes([`Assunto: ${assunto}`, "", corpo, ""].join("\n"));
}
