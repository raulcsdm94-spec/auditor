import { OPT_OUT } from "./signature";

/** Content-ID usado para referenciar o logótipo embutido (inline) no HTML. */
export const LOGO_CID = "veris-mark";

/** Cor de destaque da marca (verde VERIS), usada em links e pontos neutros. */
const COR_MARCA = "#3f7d2e";

/**
 * Rótulos de severidade usados no corpo do email (partilhados com o gerador de
 * texto em email.ts). O rótulo aparece no texto e, aqui, escolhe a cor do "ball".
 */
export const ROTULO_CRITICO = "Problema Crítico";
export const ROTULO_GRAVE = "Problema Grave";
export const ROTULO_MELHORAR = "Algo a melhorar";

/** Rótulo → cor do ponto/etiqueta, por ordem de gravidade. */
const CORES_ROTULO: { rotulo: string; cor: string }[] = [
  { rotulo: ROTULO_CRITICO, cor: "#c0392b" }, // vermelho
  { rotulo: ROTULO_GRAVE, cor: "#e67e22" }, // laranja
  { rotulo: ROTULO_MELHORAR, cor: "#c99700" }, // âmbar
];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Converte URLs à solta (http(s):// ou www.) em links clicáveis. Recebe texto já escapado. */
function linkify(escaped: string): string {
  return escaped.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (m) => {
    // Não engolir pontuação final da frase (".", ",", ")", …) para dentro do link.
    const trailing = m.match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    const url = trailing ? m.slice(0, m.length - trailing.length) : m;
    const href = url.startsWith("http") ? url : `https://${url}`;
    return `<a href="${href}" style="color:${COR_MARCA}; text-decoration:underline;">${url}</a>${trailing}`;
  });
}

/** Renderiza uma linha de bullet, com "ball" colorido e rótulo de severidade a negrito. */
function bulletToHtml(conteudo: string): string {
  const match = CORES_ROTULO.find((c) => conteudo.startsWith(`${c.rotulo}:`));
  if (match) {
    const resto = conteudo.slice(`${match.rotulo}:`.length).trim();
    const inner =
      `<span style="font-weight:bold; color:${match.cor};">${escapeHtml(match.rotulo)}:</span> ` +
      linkify(escapeHtml(resto));
    return `<div style="padding-left:22px; text-indent:-22px; margin:5px 0;"><span style="color:${match.cor}; font-size:15px;">&#9679;</span>&nbsp;&nbsp;${inner}</div>`;
  }
  // Bullet sem rótulo de severidade (ex.: email clássico): ponto neutro discreto.
  return `<div style="padding-left:18px; text-indent:-12px; margin:3px 0;"><span style="color:${COR_MARCA};">&#8226;</span> ${linkify(escapeHtml(conteudo))}</div>`;
}

/** Converte o corpo em texto simples (com bullets •) em HTML seguro e legível. */
function bodyToHtml(bodyText: string): string {
  return bodyText
    .split(/\r?\n/)
    .map((raw) => {
      const linha = raw.trimEnd();
      if (linha.trim() === "") return '<div style="height:14px; line-height:14px;">&nbsp;</div>';
      const bullet = linha.match(/^\s*[•●]\s?(.*)$/);
      if (bullet) return bulletToHtml(bullet[1]);
      return `<div>${linkify(escapeHtml(linha))}</div>`;
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
  return `<div style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:#2b2b2b; max-width:620px;">
${bodyToHtml(bodyText)}
<div style="height:20px; line-height:20px;">&nbsp;</div>
<div style="border-top:1px solid #e3e8e4; margin-bottom:16px;">&nbsp;</div>
${SIGNATURE_HTML}
<div style="height:16px; line-height:16px;">&nbsp;</div>
<div style="font-size:12px; color:#8a978f;">${escapeHtml(OPT_OUT)}</div>
</div>`;
}
