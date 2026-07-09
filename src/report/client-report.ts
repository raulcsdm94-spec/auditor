import { Finding, ORDEM_SEVERIDADE, Severidade } from "../types";
import { riscoCliente } from "./risco";
import { detetarPerfilNegocio, frasesDoPerfil, FrasesPerfil } from "./business-profile";
import type { DadosRelatorio } from "./markdown";

/**
 * Relatório do CLIENTE, escrito para o dono do negócio (não para engenheiros):
 * - "Em duas linhas" honesto no topo (o que está bem + o que está mal + o que custa);
 * - problemas AGRUPADOS por tema em linguagem simples, cada um com
 *   "O que encontrámos" e "Porque é que isto importa" (nunca o "como corrigir");
 * - "O que já está bem" (os findings informativos viram elogio, não ruído);
 * - tabela-resumo e convite final sem pressão.
 *
 * A personalização por modelo de negócio (reservas/vendas/orçamentos) só é
 * usada quando a deteção é inequívoca; na dúvida o texto fica genérico.
 */

const EMOJI: Record<Severidade, string> = {
  critico: "🔴",
  alto: "🟠",
  medio: "🟡",
  info: "🟢",
};

const ROTULO_ESTADO: Record<Severidade, string> = {
  critico: "Crítico",
  alto: "A corrigir",
  medio: "A melhorar",
  info: "Bom",
};

/** Um tema do relatório: título humano + findings agrupados. */
interface Grupo {
  titulo: string;
  severidade: Severidade;
  encontramos: string[];
  porqueImporta: string;
}

interface TemaDef {
  /** Prefixos de ids de findings que pertencem a este tema. */
  prefixos: string[];
  titulo: string;
  /** Frase extra de impacto quando o perfil do negócio é conhecido. */
  fraseperfil?: (f: FrasesPerfil) => string;
}

const TEMAS: TemaDef[] = [
  {
    prefixos: ["sec.tls."],
    titulo: "A ligação segura do site (HTTPS) tem problemas",
    fraseperfil: (f) => f.confianca,
  },
  {
    prefixos: ["legal.banner-cookies", "legal.politica-privacidade", "legal.politica-cookies", "legal.trackers"],
    titulo: "Cookies e privacidade dos visitantes (RGPD)",
  },
  {
    prefixos: ["legal.livro-reclamacoes", "legal.info-empresa"],
    titulo: "Obrigações legais portuguesas em falta",
  },
  {
    prefixos: ["sec.email."],
    titulo: "O email do domínio pode ser falsificado por terceiros",
  },
  {
    prefixos: ["legal.ecommerce.", "legal.reservas."],
    titulo: "Informação obrigatória de venda e reserva em falta",
  },
  {
    prefixos: ["sec.exposure", "sec.fingerprint", "sec.cookies.flags", "sec.login-forms"],
    titulo: "O site expõe informação que facilita ataques",
  },
  {
    prefixos: ["sec.headers.", "sec.csp-quality", "sec.sri", "sec.mixed-content"],
    titulo: "Faltam proteções de segurança no browser dos visitantes",
  },
  {
    prefixos: ["legal.a11y"],
    titulo: "Barreiras de acessibilidade para alguns visitantes",
  },
];

function maisGrave(a: Severidade, b: Severidade): Severidade {
  return ORDEM_SEVERIDADE.indexOf(a) <= ORDEM_SEVERIDADE.indexOf(b) ? a : b;
}

function sevRank(s: Severidade): number {
  return ORDEM_SEVERIDADE.indexOf(s);
}

/** Constrói os grupos temáticos a partir dos findings (só não-info). */
function agruparFindings(findings: Finding[], frases: FrasesPerfil | null): Grupo[] {
  const problemas = findings.filter((f) => f.severidade !== "info");
  const porTema = new Map<TemaDef, Finding[]>();
  const soltos: Finding[] = [];

  for (const f of problemas) {
    const tema = TEMAS.find((t) => t.prefixos.some((p) => f.id.startsWith(p)));
    if (tema) {
      const arr = porTema.get(tema) || [];
      arr.push(f);
      porTema.set(tema, arr);
    } else {
      soltos.push(f);
    }
  }

  const grupos: Grupo[] = [];
  for (const [tema, fs] of porTema) {
    const ordenados = [...fs].sort((a, b) => sevRank(a.severidade) - sevRank(b.severidade));
    const severidade = ordenados[0].severidade;

    const encontramos = ordenados.slice(0, 6).map((f) => f.descricao.replace(/\.$/, "") + ".");
    if (ordenados.length > 6) {
      encontramos.push(`E mais ${ordenados.length - 6} ponto(s) do mesmo tema, detalhados na nossa análise.`);
    }

    let porqueImporta = riscoCliente(ordenados[0]) || "";
    if (frases && tema.fraseperfil) {
      porqueImporta += " " + tema.fraseperfil(frases);
    }

    grupos.push({ titulo: tema.titulo, severidade, encontramos, porqueImporta });
  }

  // Findings fora dos temas conhecidos: um grupo "Outros pontos".
  if (soltos.length > 0) {
    const ordenados = [...soltos].sort((a, b) => sevRank(a.severidade) - sevRank(b.severidade));
    grupos.push({
      titulo: "Outros pontos a rever",
      severidade: ordenados[0].severidade,
      encontramos: ordenados.map((f) => f.descricao.replace(/\.$/, "") + "."),
      porqueImporta: riscoCliente(ordenados[0]) || "",
    });
  }

  grupos.sort((a, b) => sevRank(a.severidade) - sevRank(b.severidade));
  return grupos;
}

/** Grupo sintético de velocidade, a partir do tempo de carregamento medido. */
function grupoVelocidade(loadTimeMs: number | undefined, frases: FrasesPerfil | null): Grupo | null {
  if (!loadTimeMs || loadTimeMs <= 2500) return null;
  const seg = (loadTimeMs / 1000).toFixed(1).replace(".", ",");
  const severidade: Severidade = loadTimeMs > 8000 ? "critico" : loadTimeMs > 4000 ? "alto" : "medio";
  const generico =
    "Ao fim de poucos segundos de espera, grande parte dos visitantes fecha a página sem chegar a ver o site. A velocidade é também um dos fatores que a Google usa para decidir quem aparece primeiro.";
  return {
    titulo: `O site demora cerca de ${seg} segundos a mostrar conteúdo`,
    severidade,
    encontramos: [
      `Medimos o tempo até o conteúdo principal aparecer: cerca de ${seg}s (a Google recomenda menos de 2,5s).`,
    ],
    porqueImporta: frases ? `${generico} ${frases.velocidade}` : generico,
  };
}

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return url;
  }
}

/** Primeira letra em minúscula, preservando siglas no resto (RGPD, HTTPS...). */
function minusculaInicial(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Rede de segurança: NUNCA sai um travessão (em dash) em material do cliente.
 * Apanha também travessões vindos de descrições de checks ou rulesets.
 */
export function semTravessoes(texto: string): string {
  return texto.replace(/\s*—\s*/g, ", ").replace(/—/g, "-");
}

/**
 * Nem todos os findings "info" são elogios: alguns são observações menores
 * negativas ou notas meta. Só mostramos ao cliente os genuinamente positivos.
 */
const INFO_NEGATIVO =
  /em falta|revela|qualquer autoridade|sem texto|sem r[oó]tulo|n[aã]o classificado|ignorados|falhou|detetado nesta p[aá]gina/i;
const INFO_POSITIVO =
  /ativo|v[aá]lido|presente|nenhum|sem conte[uú]do misto|todos os recursos|corretamente|\bok\b/i;

function positivosParaCliente(findings: Finding[]): Finding[] {
  return findings.filter(
    (f) =>
      f.severidade === "info" &&
      INFO_POSITIVO.test(f.descricao) &&
      !INFO_NEGATIVO.test(f.descricao)
  );
}

/** "Em duas linhas": boa notícia + má notícia + consequência para o negócio. */
function emDuasLinhas(
  d: DadosRelatorio,
  grupos: Grupo[],
  positivos: Finding[],
  frases: FrasesPerfil | null
): string {
  const criticos = grupos.filter((g) => g.severidade === "critico").length;
  const altos = grupos.filter((g) => g.severidade === "alto").length;
  const dom = dominio(d.crawl.finalUrl);

  // Boa notícia: HTTPS válido é o elogio mais reconhecível; senão, o 1º positivo.
  const temHttpsOk = positivos.some((p) => p.id === "sec.tls.ok");
  const boa = temHttpsOk
    ? "a ligação do site é segura (HTTPS válido)"
    : positivos.length > 0
    ? "há pontos importantes já bem resolvidos"
    : "há uma base a partir da qual se pode trabalhar";

  const pior = grupos[0];
  const ma =
    criticos > 0
      ? `encontrámos ${criticos} tema(s) crítico(s) e ${altos} de risco alto, sendo o mais urgente ${minusculaInicial(pior.titulo)}`
      : altos > 0
      ? `encontrámos ${altos} tema(s) de risco alto, sendo o principal ${minusculaInicial(pior.titulo)}`
      : grupos.length > 0
      ? `encontrámos ${grupos.length} tema(s) a melhorar`
      : "não encontrámos problemas relevantes";

  const consequencia = frases
    ? frases.consequencia
    : "São pontos que custam confiança a quem visita o site, e com ela clientes, além do risco legal que alguns representam.";

  return [
    "## Em duas frases",
    "",
    `Analisámos o site da ${dom} ao detalhe. A boa notícia: ${boa}. A menos boa: ${ma}. ${consequencia}`,
    "",
  ].join("\n");
}

function comoFizemos(d: DadosRelatorio): string {
  return [
    "## Como fizemos esta análise",
    "",
    "Não usámos opiniões nem suposições. Visitámos o site tal como qualquer pessoa o visita, " +
      "lemos apenas o que ele mostra publicamente e medimos ponto por ponto, sem tocar em nada e " +
      "sem testes intrusivos. Tudo o que se segue são factos verificados a " +
      `${d.geradoEm.toLocaleDateString("pt-PT")}, e dizemos honestamente o que está mal e o que já está bem.`,
    "",
  ].join("\n");
}

function seccaoGrupos(grupos: Grupo[]): string {
  const partes: string[] = [];
  grupos.forEach((g, i) => {
    partes.push(`## ${i + 1}. ${g.titulo} ${EMOJI[g.severidade]}`);
    partes.push("");
    partes.push("**O que encontrámos:**");
    partes.push("");
    for (const e of g.encontramos) partes.push(`- ${e}`);
    partes.push("");
    partes.push(`**Porque é que isto importa:** ${g.porqueImporta}`);
    partes.push("");
  });
  return partes.join("\n");
}

function seccaoPositivos(positivos: Finding[]): string {
  if (positivos.length === 0) return "";
  const partes = [
    "## O que já está bem (a manter)",
    "",
    "Para sermos justos, há coisas a funcionar bem e que não é preciso mexer:",
    "",
  ];
  for (const p of positivos) {
    partes.push(`- ${p.descricao.replace(/\.$/, "")}.`);
  }
  partes.push("");
  return partes.join("\n");
}

function seccaoResumo(grupos: Grupo[], positivos: Finding[]): string {
  const partes = ["## Resumo da auditoria", "", "| # | Ponto | Estado |", "| --- | --- | --- |"];
  grupos.forEach((g, i) => {
    partes.push(`| ${i + 1} | ${g.titulo} | ${EMOJI[g.severidade]} ${ROTULO_ESTADO[g.severidade]} |`);
  });
  if (positivos.length > 0) {
    partes.push(`| ✔ | ${positivos.length} ponto(s) já bem resolvidos (detalhe no fim) | 🟢 Bom |`);
  }
  partes.push("");
  return partes.join("\n");
}

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

/** Gera o relatório do cliente completo em Markdown. */
export function gerarRelatorioCliente(d: DadosRelatorio): string {
  const perfil = detetarPerfilNegocio(d.crawl);
  const frases = frasesDoPerfil(perfil.perfil);

  const positivos = positivosParaCliente(d.findings);
  const grupos: Grupo[] = [];
  const vel = grupoVelocidade(d.crawl.loadTimeMs, frases);
  if (vel) grupos.push(vel);
  grupos.push(...agruparFindings(d.findings, frases));
  grupos.sort((a, b) => sevRank(a.severidade) - sevRank(b.severidade));

  const partes: string[] = [];
  partes.push(`# Auditoria de Segurança e Conformidade: ${dominio(d.crawl.finalUrl)}`);
  partes.push("");
  partes.push(`**Site auditado:** ${d.crawl.requestedUrl}  `);
  partes.push(`**Data:** ${d.geradoEm.toLocaleDateString("pt-PT")}  `);
  partes.push(`**Realizado por:** VERIS · verisaudit.com`);
  partes.push("");
  partes.push(
    "> Análise **passiva**: lemos apenas o que o site mostra publicamente, sem testes intrusivos. " +
      "As verificações legais são indicativas e não constituem aconselhamento jurídico."
  );
  partes.push("");
  partes.push(emDuasLinhas(d, grupos, positivos, frases));
  partes.push(seccaoResumo(grupos, positivos));
  partes.push(comoFizemos(d));
  partes.push(seccaoGrupos(grupos));
  partes.push(seccaoPositivos(positivos));
  partes.push(proximoPasso());

  return semTravessoes(partes.join("\n"));
}
