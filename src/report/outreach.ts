/**
 * Regras de elegibilidade de outreach, partilhadas pelo gerador de email
 * (email.ts) e pelos passos de envio (send.ts, make-drafts.ts).
 */

/** Máximo de pontos (achados) a listar num email de cold call. */
export const MAX_PONTOS_COLDCALL = 4;

/**
 * Vale a pena contactar este site?
 *
 * Só contactamos sites com problemas SÉRIOS que motivem o dono a agir —
 * tipicamente incumprimento legal ou risco real. Os achados menores
 * ("Algo a melhorar": acessibilidade, avisos preventivos) não justificam,
 * por si só, um contacto.
 *
 * Critério: pelo menos 1 crítico OU pelo menos 2 graves (altos).
 */
export function valeAPenaContactar(criticos: number, altos: number): boolean {
  return criticos >= 1 || altos >= 2;
}

/** Frase curta que explica porque um site não é elegível (para logs/preview). */
export const MOTIVO_NAO_ELEGIVEL = "sem problemas sérios (precisa de ≥1 crítico ou ≥2 graves)";
