import { Finding, CrawlResult, ORDEM_SEVERIDADE, Severidade } from "../types";
import { gerarRelatorioCliente } from "./client-report";

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

/*
 * As frases de risco/impacto para o cliente vivem em ./risco.ts
 * (partilhadas com o relatório do cliente em ./client-report.ts).
 */

function seccaoCategoria(titulo: string, findings: Finding[]): string {
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
    if (f.remediacao) {
      // Relatório interno da VERIS: mantém a remediação, como antes.
      linhas.push(`- **Remediação:** ${f.remediacao}`);
    }
    linhas.push("");
  }
  return linhas.join("\n");
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
  // O relatório do CLIENTE tem agora formato próprio (narrativo, por temas).
  if (d.audiencia === "cliente") {
    return gerarRelatorioCliente(d);
  }
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
  partes.push(seccaoCategoria(ROTULO_CATEGORIA.seguranca, seg));
  partes.push(seccaoCategoria(ROTULO_CATEGORIA.legal, legal));

  // Avisos do crawl são detalhe técnico interno.
  if (d.crawl.warnings.length > 0) {
    partes.push("## Avisos do crawl");
    partes.push("");
    for (const w of d.crawl.warnings) partes.push(`- ${w}`);
    partes.push("");
  }

  return partes.join("\n");
}
