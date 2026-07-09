import { RegisteredCheck, Finding, CrawlResult, Severidade } from "../../types";

/**
 * Classifica a gravidade da exposição de cada caminho público.
 * Ficheiros de segredos/backup são críticos; painéis de admin acessíveis
 * são, no máximo, "médio" (a sua existência não é por si só vulnerabilidade).
 */
const SEVERIDADE_POR_CAMINHO: Record<string, Severidade> = {
  "/.env": "critico",
  "/.git/config": "critico",
  "/wp-config.php.bak": "critico",
  "/wp-config.php~": "critico",
  "/backup.zip": "critico",
  "/.DS_Store": "medio",
  "/server-status": "medio",
  "/admin/": "medio",
  "/wp-admin/": "info",
  "/phpmyadmin/": "medio",
};

/**
 * Reporta caminhos públicos sensíveis que respondem com 200 OK.
 * Apenas leitura passiva — os GETs já foram feitos pelo crawler a uma
 * lista fixa de URLs; aqui só interpretamos os status codes.
 */
const check: RegisteredCheck = {
  id: "sec.exposure",
  categoria: "seguranca",
  titulo: "Exposição de ficheiros e caminhos sensíveis",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];

    for (const probe of crawl.pathProbes) {
      if (probe.status !== 200) continue;

      const sev = SEVERIDADE_POR_CAMINHO[probe.path] ?? "medio";
      findings.push({
        id: `sec.exposure${probe.path.replace(/[^\w]+/g, "-").replace(/-$/, "")}`,
        categoria: "seguranca",
        severidade: sev,
        descricao: `Caminho sensível acessível publicamente (HTTP 200): ${probe.path}`,
        evidencia: probe.bodySnippet
          ? `${probe.url}\nExcerto: ${probe.bodySnippet.replace(/\s+/g, " ").slice(0, 160)}`
          : probe.url,
        remediacao:
          "Bloquear o acesso a este caminho ao nível do servidor/CDN ou removê-lo do webroot.",
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: "sec.exposure.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao:
          "Nenhum dos caminhos sensíveis verificados está acessível publicamente.",
        evidencia: crawl.pathProbes
          .map((p) => `${p.path} -> ${p.status ?? "erro"}`)
          .join("\n"),
      });
    }

    return findings;
  },
};

export default check;
