import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/**
 * Acessibilidade básica (indicativa) com base nas métricas de DOM recolhidas
 * pelo crawler. Mapeia para critérios WCAG e ao Ato Europeu da Acessibilidade
 * (Diretiva 2019/882, aplicável desde junho de 2025). Não substitui auditoria
 * de acessibilidade completa.
 */
const check: RegisteredCheck = {
  id: "legal.acessibilidade",
  categoria: "legal",
  titulo: "Acessibilidade básica (WCAG / Ato Europeu da Acessibilidade)",
  run(crawl: CrawlResult): Finding[] {
    const a = crawl.a11y;
    if (!a.analisado) {
      return [
        {
          id: "legal.a11y.indisponivel",
          categoria: "legal",
          severidade: "info",
          descricao: "Não foi possível analisar a acessibilidade da página.",
        },
      ];
    }

    const findings: Finding[] = [];

    if (!a.htmlLang) {
      findings.push({
        id: "legal.a11y.lang",
        categoria: "legal",
        severidade: "medio",
        descricao: "O elemento <html> não declara o atributo lang (idioma da página).",
        remediacao: 'Definir lang no <html> (ex. lang="pt"). WCAG 3.1.1.',
      });
    }
    if (!a.temTitulo) {
      findings.push({
        id: "legal.a11y.title",
        categoria: "legal",
        severidade: "medio",
        descricao: "A página não tem um <title> descritivo.",
        remediacao: "Adicionar um <title> claro e único. WCAG 2.4.2.",
      });
    }
    if (a.imagensSemAlt > 0) {
      findings.push({
        id: "legal.a11y.alt",
        categoria: "legal",
        severidade: "medio",
        descricao: `${a.imagensSemAlt} de ${a.imagensTotal} imagem(ns) sem texto alternativo (alt).`,
        remediacao: 'Adicionar alt descritivo (ou alt="" para imagens decorativas). WCAG 1.1.1.',
      });
    }
    if (a.inputsSemNome > 0) {
      findings.push({
        id: "legal.a11y.labels",
        categoria: "legal",
        severidade: "medio",
        descricao: `${a.inputsSemNome} de ${a.inputsTotal} campo(s) de formulário sem rótulo acessível.`,
        remediacao:
          "Associar <label>, aria-label ou aria-labelledby a cada campo. WCAG 1.3.1 / 4.1.2.",
      });
    }
    if (a.botoesSemNome > 0) {
      findings.push({
        id: "legal.a11y.botoes",
        categoria: "legal",
        severidade: "info",
        descricao: `${a.botoesSemNome} botão(ões) sem texto ou nome acessível.`,
        remediacao: "Dar texto visível ou aria-label aos botões. WCAG 4.1.2.",
      });
    }
    if (a.saltosHeading > 0) {
      findings.push({
        id: "legal.a11y.headings",
        categoria: "legal",
        severidade: "info",
        descricao: `Estrutura de títulos com ${a.saltosHeading} salto(s) de nível (ex. h1 → h3).`,
        remediacao: "Usar níveis de heading sequenciais, sem saltos. WCAG 1.3.1.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: "legal.a11y.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Sem problemas básicos de acessibilidade detetados (verificação indicativa).",
      });
    }
    return findings;
  },
};

export default check;
