/**
 * Tipos partilhados entre o crawler, os checks e o gerador de relatório.
 * São o "contrato" do projeto: um check recebe um CrawlResult e devolve Findings.
 */

export type Categoria = "seguranca" | "legal";

export type Severidade = "critico" | "alto" | "medio" | "info";

/** Ordem usada para ordenar o relatório (índice menor = mais grave). */
export const ORDEM_SEVERIDADE: Severidade[] = ["critico", "alto", "medio", "info"];

/** Resultado individual produzido por um check. */
export interface Finding {
  /** Identificador estável e único, ex. "sec.headers.csp-missing". */
  id: string;
  categoria: Categoria;
  severidade: Severidade;
  /** Descrição legível do problema (ou da conformidade, com severidade "info"). */
  descricao: string;
  /** Evidência concreta: header em falta, excerto de HTML, URL, etc. */
  evidencia?: string;
  /** Sugestão de remediação opcional (o "como corrigir"; só no relatório interno). */
  remediacao?: string;
  /**
   * Frase de risco/impacto para o cliente (o "porquê importa").
   * Opcional: se não definida, o relatório do cliente usa o mapa central de
   * riscos em report/markdown.ts. Nunca revela os passos de correção.
   */
  risco?: string;
}

/** Cookie observado durante o crawl. */
export interface CapturedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: "Strict" | "Lax" | "None" | string;
  expires: number;
}

/** Pedido de rede observado durante o carregamento da página. */
export interface CapturedRequest {
  url: string;
  method: string;
  resourceType: string;
}

/** Detalhes do certificado/ligação TLS da resposta principal. */
export interface TlsInfo {
  /** A página final foi servida sobre HTTPS? */
  isHttps: boolean;
  protocol?: string; // ex. "TLS 1.3"
  issuer?: string;
  subjectName?: string;
  /** Epoch em segundos (como devolvido pelo Playwright). */
  validFrom?: number;
  validTo?: number;
}

/** Resultado de uma tentativa passiva de leitura de um caminho público. */
export interface PathProbe {
  path: string;
  url: string;
  status: number | null;
  /** Excerto curto do corpo, apenas para evidência. */
  bodySnippet?: string;
  error?: string;
}

/** Formulário detetado no HTML. */
export interface DetectedForm {
  action: string;
  /** action resolvido para URL absoluto, quando possível. */
  resolvedAction: string;
  method: string;
  /** Heurística: parece de autenticação (login/registo)? */
  isAuthLike: boolean;
  hasPasswordField: boolean;
}

/** Conteúdo individual de uma página visitada durante o crawl. */
export interface PaginaCapturada {
  url: string;
  /** <title> da página (pode ser vazio). */
  titulo: string;
  /** Texto visível da página (lowercase). */
  visibleText: string;
}

/** Tudo o que o crawler recolhe e entrega aos checks. */
export interface CrawlResult {
  /** URL pedido pelo utilizador. */
  requestedUrl: string;
  /** URL final após redirecionamentos. */
  finalUrl: string;
  statusCode: number | null;
  /** Tempo (ms) de carregamento até domcontentloaded, para menção no outreach. */
  loadTimeMs?: number;
  html: string;
  /** Texto visível da página (lowercase) para procuras textuais. */
  visibleText: string;
  /** Headers da resposta do documento principal (chaves em lowercase). */
  headers: Record<string, string>;
  cookies: CapturedCookie[];
  requests: CapturedRequest[];
  tls: TlsInfo;
  forms: DetectedForm[];
  /** Sondagens passivas a caminhos públicos conhecidos. */
  pathProbes: PathProbe[];
  /** Páginas efetivamente carregadas (a principal + subpáginas seguidas). */
  paginasVisitadas: string[];
  /**
   * Conteúdo POR PÁGINA (a principal + cada subpágina), para os checks que
   * precisam de analisar uma página específica — ex.: avaliar a qualidade do
   * texto da Política de Cookies, ou ver se a Política de Privacidade cobre
   * cookies — em vez de procurar no blob concatenado de todas as páginas.
   */
  paginas?: PaginaCapturada[];
  /** O site processa pagamento online no próprio site (gateway/campos de cartão)? */
  processaPagamento: boolean;
  /** Foi alcançada uma página de checkout/pagamento durante o crawl? */
  checkoutAlcancado: boolean;
  /** Resolução DNS do domínio (segurança de email/domínio). */
  dns: DnsInfo;
  /** Métricas de acessibilidade da página principal. */
  a11y: A11yInfo;
  /**
   * Textos (lowercase, curtos) dos elementos CLICÁVEIS da página principal:
   * botões, links, [role=button] e inputs de submissão, incluindo iframes e
   * shadow DOM abertos. Servem para distinguir uma AÇÃO real (ex.: botão
   * "Rejeitar" num banner de cookies) de uma mera menção no texto corrido
   * (ex.: "pode recusar os cookies clicando em…"), que não é uma opção real.
   */
  clickableTexts?: string[];
  screenshotPath?: string;
  /**
   * Preenchido quando o crawl foi barrado por uma página de desafio/anti-bot
   * (WAF, DDoS-Guard, Cloudflare…) e NÃO chegámos a ver o site real. Nestes
   * casos a auditoria é abortada para não gerar falsos positivos.
   */
  bloqueado?: { motivo: string };
  /** Erros não-fatais ocorridos durante o crawl. */
  warnings: string[];
}

/** Resultado da resolução DNS do domínio (consultas públicas e passivas). */
export interface DnsInfo {
  /** Domínio registável consultado (ex. "exemplo.com"). */
  dominio: string;
  /** Registos MX (servidores de email), ordenados por prioridade. */
  mx: string[];
  /** Registo SPF (TXT começado por "v=spf1"), se existir. */
  spf?: string;
  /** Registo DMARC (TXT em _dmarc.<dominio>), se existir. */
  dmarc?: string;
  /** Registos CAA (autoridades autorizadas a emitir certificados). */
  caa: string[];
  /** Erros não-fatais durante a resolução DNS. */
  erros: string[];
}

/** Métricas de acessibilidade recolhidas do DOM da página principal. */
export interface A11yInfo {
  /** A página foi analisada com sucesso? (falso se o DOM não foi lido) */
  analisado: boolean;
  /** Valor do atributo lang do <html>, se presente. */
  htmlLang?: string;
  /** A página tem um <title> não vazio? */
  temTitulo: boolean;
  imagensTotal: number;
  imagensSemAlt: number;
  inputsTotal: number;
  inputsSemNome: number;
  botoesSemNome: number;
  /** Nº de saltos na hierarquia de headings (ex. h1 -> h3). Heurística. */
  saltosHeading: number;
}

/** Assinatura de qualquer check. */
export type Check = (crawl: CrawlResult, ctx: CheckContext) => Finding[] | Promise<Finding[]>;

/** Metadados de um check registado. */
export interface RegisteredCheck {
  id: string;
  categoria: Categoria;
  /** Descrição do que o check verifica (para documentação/listagem). */
  titulo: string;
  run: Check;
}

/** Contexto extra disponibilizado aos checks. */
export interface CheckContext {
  /** Código de país normalizado, ex. "pt" -> ruleset "pt-PT". */
  country: string;
  /** Ruleset legal carregado para o país. */
  legalRules: LegalRuleset;
  /** O site é uma loja online? (influencia checks de e-commerce) */
  isEcommerce: boolean;
  /** O site é de reservas/marcações? */
  isBooking: boolean;
}

/** Estrutura de um ruleset legal por país (ficheiro JSON). */
export interface LegalRuleset {
  country: string;
  language: string;
  /** Padrões textuais procurados no HTML/links para cada requisito. */
  patterns: {
    livroReclamacoes: string[];
    politicaPrivacidade: string[];
    politicaCookies: string[];
    bannerCookies: string[];
    rejeitarCookies: string[];
    infoEmpresa: string[];
    identificadorFiscal: string[];
    direitoRetratacao: string[];
    politicaReembolso: string[];
    termosCancelamento: string[];
  };
  /** Texto de remediação por requisito (mostrado no relatório). */
  remediacao: Record<string, string>;
}
