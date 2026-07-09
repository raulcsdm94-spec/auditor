import { OPT_OUT } from "./signature";

/** Content-ID usado para referenciar o logótipo embutido (inline) no HTML. */
export const LOGO_CID = "veris-mark";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converte o corpo em texto simples (com bullets •) em HTML seguro e legível. */
function bodyToHtml(bodyText: string): string {
  return bodyText
    .split(/\r?\n/)
    .map((raw) => {
      const linha = raw.trimEnd();
      if (linha === "") return '<div style="height:14px; line-height:14px;">&nbsp;</div>';
      if (linha.startsWith("•")) {
        const txt = escapeHtml(linha.replace(/^•\s?/, ""));
        return `<div style="padding-left:18px; text-indent:-12px;">• ${txt}</div>`;
      }
      return `<div>${escapeHtml(linha)}</div>`;
    })
    .join("\n");
}

/** Bloco de assinatura em HTML (nome + cargo + contactos + logótipo VERIS). */
const SIGNATURE_HTML = `
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse; font-family:Arial,Helvetica,sans-serif;">
  <tr>
    <td style="vertical-align:middle; padding-right:18px;">
      <div style="font-size:15px; font-weight:bold; color:#0a2b29; padding-bottom:3px;">Raul Dantas</div>
      <div style="font-size:13px; color:#5b6b62; padding-bottom:1px;">Analista de Segurança</div>
      <div style="font-size:13px; color:#5b6b62; padding-bottom:1px;">Veris Audit</div>
      <div style="font-size:13px; padding-bottom:1px;"><a href="mailto:hello@verisaudit.com" style="color:#5b6b62; text-decoration:none;">hello@verisaudit.com</a></div>
      <div style="font-size:13px;"><a href="https://www.verisaudit.com/" style="color:#3f7d2e; text-decoration:underline;">https://www.verisaudit.com/</a></div>
    </td>
    <td style="vertical-align:middle;">
      <img src="cid:${LOGO_CID}" width="46" height="46" alt="VERIS" style="display:block; border:0;" />
    </td>
  </tr>
</table>`.trim();

/**
 * Monta o corpo HTML completo do email: texto convertido + assinatura de marca
 * + rodapé de opt-out (RGPD). Legível em fundo branco (a maioria das inboxes).
 */
export function buildEmailHtml(bodyText: string): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.5; color:#222222;">
${bodyToHtml(bodyText)}
<div style="height:18px; line-height:18px;">&nbsp;</div>
${SIGNATURE_HTML}
<div style="height:16px; line-height:16px;">&nbsp;</div>
<div style="font-size:12px; color:#8a978f;">${escapeHtml(OPT_OUT)}</div>
</div>`;
}
