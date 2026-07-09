import { Finding, CrawlResult, ORDEM_SEVERIDADE, Severidade } from "../types";

const ROTULO_SEVERIDADE: Record<Severidade, string> = {
  critico: "🔴 Risco Crítico",
  alto: "🟠 Risco Alto",
  medio: "🟡 Risco Médio",
  info: "🟢 Informativo",
};

const ROTULO_CATEGORIA: Record<string, string> = {
  seguranca: "Segurança",
  legal: "Conformidade Legal",
};

function ordenarFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      ORDEM_SEVERIDADE.indexOf(a.severidade) - ORDEM_SEVERIDADE.indexOf(b.severidade)
  );
}

function contar(findings: Finding[], sev: Severidade): number {
  return findings.filter((f) => f.severidade === sev).length;
}

/** Constrói o resumo executivo no topo do relatório. */
function resumoExecutivo(findings: Finding[]): string {
  const seg = findings.filter((f) => f.categoria === "seguranca");
  const legal = findings.filter((f) => f.categoria === "legal");

  const criticos = contar(findings, "critico");
  const altos = contar(findings, "alto");
  const medios = contar(findings, "medio");
  const legalProblemas = legal.filter((f) => f.severidade !== "info").length;

  const frases: string[] = [];
  frases.push(
    `**${criticos}** problema(s) crítico(s), **${altos}** de severidade alta, **${medios}** de severidade média.`
  );
  frases.push(`**${legalProblemas}** questão(ões) de conformidade legal a corrigir.`);

  const linhas = [
    "## Resumo Executivo",
    "",
    frases.join(" "),
    "",
    "| Severidade | Total | Segurança | Legal |",
    "| --- | --- | --- | --- |",
  ];
  for (const sev of ORDEM_SEVERIDADE) {
    linhas.push(
      `| ${ROTULO_SEVERIDADE[sev]} | ${contar(findings, sev)} | ${contar(
        seg,
        sev
      )} | ${contar(legal, sev)} |`
    );
  }
  return linhas.join("\n");
}

/**
 * Frase de RISCO/IMPACTO mostrada ao cliente para cada problema.
 * Centralizada aqui (como no site) para ser fácil de manter. A chave é o `id`
 * exato; ids dinâmicos são apanhados por prefixo; o resto cai no genérico.
 * O "como corrigir" (remediação) nunca entra aqui — é o produto pago.
 */
const RISCO_POR_ID: Record<string, string> = {
  "sec.headers.csp-missing":
    "Sem uma Content-Security-Policy, o site fica mais vulnerável a ataques de XSS e injeção de conteúdo, que podem roubar dados ou sessões dos visitantes.",
  "sec.headers.hsts-missing":
    "Sem HSTS, um visitante pode ser silenciosamente reencaminhado para uma ligação HTTP insegura e ter o tráfego intercetado.",
  "sec.headers.x-frame-options-missing":
    "Sem proteção contra clickjacking, o site pode ser embebido noutro para enganar utilizadores e levá-los a ações não intencionais.",
  "sec.headers.x-content-type-options-missing":
    "O browser pode interpretar ficheiros como tipos errados (MIME sniffing), abrindo porta à execução de conteúdo malicioso.",
  "sec.tls.no-https":
    "Sem HTTPS, todo o tráfego, incluindo dados pessoais e credenciais, circula em texto simples e pode ser lido ou alterado por terceiros.",
  "sec.tls.protocolo-fraco":
    "Protocolos TLS obsoletos têm fraquezas conhecidas que podem permitir decifrar ou adulterar a ligação.",
  "sec.tls.cert-expirado":
    "Com o certificado expirado, os browsers mostram avisos de segurança bem visíveis e os visitantes perdem a confiança no site.",
  "sec.tls.cert-a-expirar":
    "Quando o certificado expirar, os visitantes passam a ver avisos de segurança e muitos abandonam o site.",
  "sec.tls.cert-ainda-nao-valido":
    "Um certificado fora do período de validade leva os browsers a rejeitar a ligação como insegura.",
  "legal.banner-cookies.missing":
    "Recolher dados de visitantes sem consentimento válido viola o RGPD e expõe o negócio a queixas e coimas.",
  "legal.banner-cookies.sem-rejeitar":
    "Um banner sem opção real de recusar não cumpre o RGPD: o consentimento não é válido e o site fica exposto a queixas e coimas.",
  "legal.banner-cookies.tracking-sem-consentimento":
    "Disparar cookies de tracking antes do consentimento viola o RGPD/ePrivacy e é um dos focos mais comuns de fiscalização.",
  "legal.politica-privacidade.missing":
    "Sem Política de Privacidade, o site incumpre uma obrigação central do RGPD, com risco direto de coimas e perda de confiança.",
  "legal.politica-cookies.missing":
    "Sem Política de Cookies, os visitantes não sabem que dados são recolhidos, violando requisitos de transparência do RGPD.",
  "legal.livro-reclamacoes.missing":
    "A ausência do Livro de Reclamações Eletrónico é uma infração sujeita a coima para prestadores de serviços.",
  "legal.info-empresa.sem-id-fiscal":
    "A falta de identificação fiscal obrigatória pode constituir infração e mina a credibilidade legal do negócio.",
  "legal.info-empresa.sem-identificacao":
    "Sem identificação clara da empresa, o site incumpre deveres de informação e transmite menos confiança aos clientes.",
  "legal.ecommerce.sem-direito-retratacao":
    "Não informar o direito de livre resolução de 14 dias viola os direitos do consumidor e pode gerar queixas e coimas.",
  "legal.ecommerce.sem-politica-reembolso":
    "Sem política de reembolso/cancelamento clara, aumentam os litígios com clientes e o risco de queixas.",
  "legal.reservas.sem-termos-cancelamento":
    "Sem termos de cancelamento visíveis antes do pagamento, o site fica exposto a disputas e queixas de consumidores.",
};

/** Ids dinâmicos (com sufixo variável) apanhados por prefixo. */
const RISCO_POR_PREFIXO: [string, string][] = [
  [
    "sec.cookies.flags.",
    "Cookies sem as flags de segurança corretas podem ser intercetados ou lidos por terceiros, permitindo o sequestro da sessão do utilizador.",
  ],
  [
    "sec.exposure",
    "Ficheiros ou caminhos sensíveis acessíveis publicamente podem revelar segredos, configurações ou dados internos a qualquer pessoa na internet.",
  ],
  [
    "sec.fingerprint.cms.",
    "Software desatualizado tem vulnerabilidades públicas conhecidas que os atacantes procuram e exploram ativamente.",
  ],
  [
    "sec.login-forms.http.",
    "Credenciais submetidas sobre HTTP podem ser intercetadas, dando a terceiros acesso direto às contas dos utilizadores.",
  ],
  [
    "sec.mixed-content",
    "Recursos carregados sobre HTTP numa página segura podem ser intercetados ou adulterados, comprometendo a página inteira.",
  ],
  [
    "sec.csp-quality",
    "Uma Content-Security-Policy fraca deixa passar ataques de XSS e injeção, que podem roubar dados ou sessões dos visitantes.",
  ],
  [
    "sec.sri",
    "Sem verificação de integridade, um recurso de terceiros comprometido executa no seu site e pode roubar dados dos visitantes.",
  ],
  [
    "sec.email.spf",
    "Sem um SPF eficaz, qualquer pessoa pode enviar emails que parecem vir do seu domínio, facilitando phishing em nome da sua marca.",
  ],
  [
    "sec.email.dmarc",
    "Sem DMARC ativo, é trivial falsificar emails do seu domínio para enganar clientes, parceiros e a própria equipa.",
  ],
  [
    "legal.trackers",
    "Carregar trackers de terceiros e enviar dados para fora da UE sem base legal e consentimento expõe o negócio a queixas e coimas (RGPD).",
  ],
  [
    "legal.a11y",
    "Barreiras de acessibilidade excluem utilizadores com deficiência e podem violar o Ato Europeu da Acessibilidade, com risco legal e reputacional.",
  ],
];

/** Risco genérico por categoria, quando não há texto específico. */
const RISCO_GENERICO: Record<string, string> = {
  seguranca:
    "Esta lacuna de segurança aumenta a probabilidade de comprometimento do site e de exposição de dados dos visitantes.",
  legal:
    "Este incumprimento pode resultar em queixas, coimas de entidades reguladoras e perda de confiança dos clientes.",
};

/** Devolve a frase de risco para o cliente, ou undefined (ex.: findings "info"). */
function riscoCliente(f: Finding): string | undefined {
  if (f.severidade === "info") return undefined;
  if (f.risco) return f.risco;
  if (RISCO_POR_ID[f.id]) return RISCO_POR_ID[f.id];
  for (const [prefixo, txt] of RISCO_POR_PREFIXO) {
    if (f.id.startsWith(prefixo)) return txt;
  }
  return RISCO_GENERICO[f.categoria];
}

function seccaoCategoria(titulo: string, findings: Finding[], cliente: boolean): string {
  if (findings.length === 0) return "";
  const linhas = [`## ${titulo}`, ""];
  for (const f of ordenarFindings(findings)) {
    linhas.push(`### ${ROTULO_SEVERIDADE[f.severidade]}: ${f.descricao}`);
    linhas.push("");
    linhas.push(`- **ID:** \`${f.id}\``);
    if (f.evidencia) {
      linhas.push(`- **Evidência:**`);
      linhas.push("");
      linhas.push("  ```");
      for (const l of f.evidencia.split("\n")) linhas.push(`  ${l}`);
      linhas.push("  ```");
    }
    if (cliente) {
      // Relatório do cliente: mostramos o RISCO/IMPACTO, nunca o "como corrigir".
      const risco = riscoCliente(f);
      if (risco) linhas.push(`- **Risco:** ${risco}`);
    } else if (f.remediacao) {
      // Relatório interno da VERIS: mantém a remediação, como antes.
      linhas.push(`- **Remediação:** ${f.remediacao}`);
    }
    linhas.push("");
  }
  return linhas.join("\n");
}

/** Bloco final, só no relatório do cliente, que conduz à correção paga. */
function proximoPasso(): string {
  return [
    "## Próximo passo",
    "",
    "Este relatório mostra o que está em risco no seu site e o porquê de estar. Nós não " +
      "colocamos nada em causa, enviamos o relatório para vossa informação.",
    "",
    "Simplesmente sugerimos que tenha em atenção resolver os riscos ou problemas, e se " +
      "quiser que a nossa equipa o faça, podemos agendar uma consulta e dar-lhe um " +
      "orçamento e fazê-lo por si. Se assim o quiser, apenas tem de responder ao nosso " +
      "email ou enviar-nos email diretamente para **hello@verisaudit.com**.",
    "",
  ].join("\n");
}

export interface DadosRelatorio {
  crawl: CrawlResult;
  findings: Finding[];
  country: string;
  geradoEm: Date;
  /**
   * Público-alvo do relatório:
   * - "interno": relatório completo da VERIS, com remediação (default).
   * - "cliente": diagnóstico sem os passos de correção (o produto pago).
   */
  audiencia?: "interno" | "cliente";
}

/** Gera o relatório completo em Markdown. */
export function gerarMarkdown(d: DadosRelatorio): string {
  const cliente = d.audiencia === "cliente";
  const seg = d.findings.filter((f) => f.categoria === "seguranca");
  const legal = d.findings.filter((f) => f.categoria === "legal");

  const partes: string[] = [];
  partes.push(`# Relatório de Auditoria de Segurança e Conformidade`);
  partes.push("");
  partes.push(`**Site auditado:** ${d.crawl.requestedUrl}`);
  partes.push("");
  partes.push(`- **URL final:** ${d.crawl.finalUrl}`);
  partes.push(`- **Estado HTTP:** ${d.crawl.statusCode ?? "n/d"}`);
  partes.push(`- **País/ruleset:** ${d.country}`);
  partes.push(`- **Data:** ${d.geradoEm.toLocaleString("pt-PT")}`);
  partes.push("");
  partes.push(
    "> ⚠️ Scanner **passivo** para uso **autorizado**. Apenas leitura de conteúdo público; sem brute-force, scanning de portas ou exploração ativa. As verificações legais são indicativas e não constituem aconselhamento jurídico."
  );
  partes.push("");
  partes.push(resumoExecutivo(d.findings));
  partes.push("");
  partes.push(seccaoCategoria(ROTULO_CATEGORIA.seguranca, seg, cliente));
  partes.push(seccaoCategoria(ROTULO_CATEGORIA.legal, legal, cliente));

  // Avisos do crawl são detalhe técnico interno — fora do relatório do cliente.
  if (!cliente && d.crawl.warnings.length > 0) {
    partes.push("## Avisos do crawl");
    partes.push("");
    for (const w of d.crawl.warnings) partes.push(`- ${w}`);
    partes.push("");
  }

  // O relatório do cliente termina com o convite à correção (paga).
  if (cliente) {
    partes.push(proximoPasso());
  }

  return partes.join("\n");
}
