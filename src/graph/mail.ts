import * as fs from "fs";
import * as path from "path";

/** Config de acesso ao Microsoft Graph (client-credentials, app-only). */
export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
}

export function loadGraphConfig(mailboxOverride?: string): GraphConfig {
  const tenantId = process.env.GRAPH_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  const mailbox = mailboxOverride || process.env.GRAPH_SENDER_MAILBOX;

  const faltam = [
    !tenantId && "GRAPH_TENANT_ID",
    !clientId && "GRAPH_CLIENT_ID",
    !clientSecret && "GRAPH_CLIENT_SECRET",
    !mailbox && "GRAPH_SENDER_MAILBOX (ou --mailbox)",
  ].filter(Boolean);
  if (faltam.length) {
    throw new Error(`Configuração do Graph incompleta, falta: ${faltam.join(", ")}`);
  }
  return { tenantId: tenantId!, clientId: clientId!, clientSecret: clientSecret!, mailbox: mailbox! };
}

interface CachedToken {
  token: string;
  expiresAt: number;
}
let cached: CachedToken | null = null;

/** Obtém (e reutiliza) um token app-only via client-credentials flow. */
export async function getAccessToken(cfg: GraphConfig): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.token;

  const url = `https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Falha a obter token (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cached.token;
}

export interface MailAttachment {
  path: string;
  contentType: string;
  /** Se definido, o anexo é embutido (inline) e referenciável no HTML via cid:<contentId>. */
  contentId?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  /** Corpo em texto simples. Usado se `html` não for fornecido. */
  bodyText: string;
  /** Corpo em HTML. Se definido, é enviado como HTML em vez de texto. */
  html?: string;
  attachments?: MailAttachment[];
}

/** Envia um email via Graph a partir da caixa configurada (POST /users/{mailbox}/sendMail). */
export async function sendMail(cfg: GraphConfig, opts: SendMailOptions): Promise<void> {
  const token = await getAccessToken(cfg);

  const attachments = (opts.attachments || []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: path.basename(a.path),
    contentType: a.contentType,
    contentBytes: fs.readFileSync(a.path).toString("base64"),
    ...(a.contentId ? { contentId: a.contentId, isInline: true } : {}),
  }));

  const payload = {
    message: {
      subject: opts.subject,
      body: opts.html
        ? { contentType: "HTML", content: opts.html }
        : { contentType: "Text", content: opts.bodyText },
      toRecipients: [{ emailAddress: { address: opts.to } }],
      attachments,
    },
    saveToSentItems: true,
  };

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.mailbox)}/sendMail`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Falha a enviar (${res.status}): ${await res.text()}`);
  }
}
