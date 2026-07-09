import { RegisteredCheck, Finding } from "../../types";
import { encontrarPadrao } from "./_shared";

/**
 * Verifica se existe um banner de cookies e se este oferece uma opção real
 * de rejeitar (e não apenas "Aceitar"). Também sinaliza cookies não
 * essenciais definidos sem consentimento aparente.
 */
const check: RegisteredCheck = {
  id: "legal.banner-cookies",
  categoria: "legal",
  titulo: "Banner de cookies com opção real de rejeitar",
  run(crawl, ctx): Finding[] {
    const findings: Finding[] = [];
    const r = ctx.legalRules.patterns;

    const banner = encontrarPadrao(crawl, r.bannerCookies);
    const rejeitar = encontrarPadrao(crawl, r.rejeitarCookies);

    if (!banner) {
      findings.push({
        id: "legal.banner-cookies.missing",
        categoria: "legal",
        severidade: "alto",
        descricao: "Não foi detetado banner de consentimento de cookies.",
        remediacao: ctx.legalRules.remediacao.bannerCookies,
      });
    } else if (!rejeitar) {
      findings.push({
        id: "legal.banner-cookies.sem-rejeitar",
        categoria: "legal",
        severidade: "alto",
        descricao:
          "Banner de cookies presente, mas sem opção clara de rejeitar (apenas aceitar).",
        evidencia: `Banner detetado por "${banner.match}"; nenhuma opção de rejeição encontrada.`,
        remediacao: ctx.legalRules.remediacao.rejeitarCookies,
      });
    } else {
      findings.push({
        id: "legal.banner-cookies.ok",
        categoria: "legal",
        severidade: "info",
        descricao: "Banner de cookies com opção de aceitar e de rejeitar encontrado.",
        evidencia: `Banner: "${banner.match}"; Rejeição: "${rejeitar.match}"`,
      });
    }

    // Cookies não essenciais definidos no carregamento inicial (heurística)
    const naoEssenciais = crawl.cookies.filter((c) =>
      /_ga|_gid|_fbp|_gcl|fr|sid|analytics|doubleclick|hubspot/i.test(c.name)
    );
    if (naoEssenciais.length > 0) {
      findings.push({
        id: "legal.banner-cookies.tracking-sem-consentimento",
        categoria: "legal",
        severidade: "medio",
        descricao:
          "Cookies de tracking/analytics aparentemente definidos no carregamento, antes de consentimento.",
        evidencia: naoEssenciais.map((c) => c.name).join(", "),
        remediacao:
          "Não definir cookies não essenciais antes do consentimento explícito do utilizador.",
      });
    }

    return findings;
  },
};

export default check;
