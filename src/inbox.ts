#!/usr/bin/env node
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { loadEnv } from "./env";
import { loadGraphConfig, listInboxMessages, GraphMessage } from "./graph/mail";
import { dominioDe } from "./report/suppression";

/**
 * Triagem do inbox: lê a caixa de envio via Microsoft Graph e cruza as
 * mensagens recebidas com o log de envios (_sent-log.json) para separar:
 *
 *   • RESPOSTA  — um lead que contactámos respondeu (fulfillment / não voltar a insistir)
 *   • OPT-OUT   — pediu para sair ("remover") → deve entrar na lista de supressão
 *   • BOUNCE    — o email voltou (endereço morto) → parar de contactar
 *
 * Passivo e só de leitura: NUNCA marca como lido, move ou apaga mensagens.
 * Por omissão apenas RELATA. Com --apply escreve os opt-outs e bounces em
 * _supressao.txt e regista tudo em _respostas.csv.
 *
 * Requer a permissão de aplicação Mail.Read no registo de app do Azure AD
 * (além do Mail.Send já usado no envio). Sem ela, o Graph responde 403.
 */

interface InboxOpts {
  out: string;
  mailbox?: string;
  days: string;
  apply: boolean;
}

interface SentLogEntry {
  url: string;
  email: string;
  sentAt: string;
}
type SentLog = Record<string, SentLogEntry>;

type Tipo = "resposta" | "opt-out" | "bounce";

interface Classificacao {
  tipo: Tipo;
  email: string; // o endereço do lead (não o do postmaster, no caso de bounce)
  url: string;
  assunto: string;
  recebidoEm: string;
}

const OPT_OUT_RE =
  /\b(remover|removam|remove me|unsubscribe|descadastr|cancelar (a )?subscri|parar de receber|não (quero|pretendo|desejo).*(receber|contact)|deixar de receber)\b/i;

const NDR_LOCALPARTS = /^(postmaster|mailer-daemon|mail delivery|microsoftexchange)/i;
const NDR_ASSUNTO =
  /(undeliverable|delivery (has )?failed|delivery status notification|returned mail|mail delivery (failed|subsystem)|não foi entregue|falha na entrega|devolvido)/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function lerSentLog(p: string): SentLog {
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return {};
  }
}

/** Deteta se uma mensagem é um relatório de não-entrega (NDR/bounce). */
function ehBounce(m: GraphMessage): boolean {
  const local = m.from.split("@")[0] || "";
  return NDR_LOCALPARTS.test(local) || NDR_ASSUNTO.test(m.subject);
}

function main() {
  loadEnv();

  const program = new Command();
  program
    .name("veris-inbox")
    .description("Triagem do inbox: respostas, opt-outs e bounces cruzados com o log de envios.")
    .option("--out <dir>", "pasta dos relatórios (onde está o _sent-log.json)", "reports")
    .option("--mailbox <email>", "caixa a ler (por omissão GRAPH_SENDER_MAILBOX do .env)")
    .option("--days <n>", "quantos dias para trás ler o inbox", "30")
    .option("--apply", "escreve opt-outs/bounces em _supressao.txt e regista _respostas.csv", false)
    .parse(process.argv);
  const opts = program.opts<InboxOpts>();

  const outDir = path.resolve(process.cwd(), opts.out);
  const logPath = path.join(outDir, "_sent-log.json");
  if (!fs.existsSync(logPath)) {
    console.error(`✖ Não encontrei ${logPath}. Ainda não há envios para cruzar.`);
    process.exitCode = 3;
    return;
  }

  let cfg;
  try {
    cfg = loadGraphConfig(opts.mailbox);
  } catch (e) {
    console.error(`✖ ${(e as Error).message}`);
    process.exitCode = 3;
    return;
  }

  const log = lerSentLog(logPath);
  // Índices para cruzar remetentes com quem contactámos.
  const porEmail = new Map<string, SentLogEntry>();
  const dominios = new Map<string, SentLogEntry>();
  for (const e of Object.values(log)) {
    const em = e.email.trim().toLowerCase();
    if (em) porEmail.set(em, e);
    const d = dominioDe(em) || dominioDe(e.url);
    if (d) dominios.set(d, e);
  }

  const dias = parseInt(opts.days, 10) || 30;
  const since = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);

  listInboxMessages(cfg, { since, top: 200 })
    .then((mensagens) => processar(mensagens, { porEmail, dominios, opts, outDir, dias }))
    .catch((e) => {
      const msg = (e as Error).message;
      console.error(`✖ ${msg}`);
      if (/\b403\b/.test(msg)) {
        console.error(
          "\nParece faltar a permissão Mail.Read. No Azure AD, no registo da app:\n" +
            "  API permissions → Add → Microsoft Graph → Application → Mail.Read → Grant admin consent."
        );
      }
      process.exitCode = 1;
    });
}

function processar(
  mensagens: GraphMessage[],
  ctx: {
    porEmail: Map<string, SentLogEntry>;
    dominios: Map<string, SentLogEntry>;
    opts: InboxOpts;
    outDir: string;
    dias: number;
  }
) {
  const { porEmail, dominios, opts, outDir, dias } = ctx;
  const classificacoes: Classificacao[] = [];

  for (const m of mensagens) {
    if (ehBounce(m)) {
      // Descobrir qual dos endereços contactados consta do corpo do NDR.
      const enderecos = (m.bodyPreview.match(EMAIL_RE) || []).map((x) => x.toLowerCase());
      const alvo = enderecos.find((a) => porEmail.has(a));
      if (alvo) {
        const e = porEmail.get(alvo)!;
        classificacoes.push({ tipo: "bounce", email: alvo, url: e.url, assunto: m.subject, recebidoEm: m.receivedDateTime });
      }
      continue;
    }

    const lead = porEmail.get(m.from) || dominios.get(dominioDe(m.from));
    if (!lead) continue; // não é resposta a um outreach nosso

    const optOut = OPT_OUT_RE.test(m.subject) || OPT_OUT_RE.test(m.bodyPreview);
    classificacoes.push({
      tipo: optOut ? "opt-out" : "resposta",
      email: lead.email.toLowerCase(),
      url: lead.url,
      assunto: m.subject,
      recebidoEm: m.receivedDateTime,
    });
  }

  const respostas = classificacoes.filter((c) => c.tipo === "resposta");
  const optOuts = classificacoes.filter((c) => c.tipo === "opt-out");
  const bounces = classificacoes.filter((c) => c.tipo === "bounce");

  console.log(`\n📥 Inbox dos últimos ${dias} dia(s): ${mensagens.length} mensagem(ns) lida(s).\n`);
  mostrar("💬 Respostas de leads (fazer fulfillment / não insistir)", respostas);
  mostrar("🚫 Pedidos de opt-out ('remover')", optOuts);
  mostrar("↩️  Bounces (endereço morto)", bounces);

  if (!opts.apply) {
    console.log(
      "\n(Só relatório.) Corre com --apply para acrescentar opt-outs e bounces à lista de supressão\n" +
        "e registar tudo em _respostas.csv."
    );
    return;
  }

  // --apply: acrescenta opt-outs (por domínio, para apanhar qualquer endereço do
  // negócio) e bounces (por email exato, o endereço morto) a _supressao.txt.
  const supressaoPath = path.join(path.dirname(outDir), "_supressao.txt");
  const existentes = fs.existsSync(supressaoPath) ? fs.readFileSync(supressaoPath, "utf-8") : "";
  const jaLa = new Set(
    existentes
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim().toLowerCase())
      .filter(Boolean)
  );
  const novas: string[] = [];
  const acrescentar = (valor: string, motivo: string) => {
    const v = valor.trim().toLowerCase();
    if (!v || jaLa.has(v)) return;
    jaLa.add(v);
    novas.push(`${v}    # ${motivo} (${new Date().toISOString().slice(0, 10)})`);
  };
  for (const c of optOuts) acrescentar(dominioDe(c.email) || c.email, "opt-out");
  for (const c of bounces) acrescentar(c.email, "bounce");

  if (novas.length) {
    const prefixo = existentes && !existentes.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(supressaoPath, prefixo + novas.join("\n") + "\n", "utf-8");
    console.log(`\n✔ ${novas.length} entrada(s) nova(s) acrescentada(s) a ${supressaoPath}`);
  } else {
    console.log("\n(Nenhuma entrada nova para a lista de supressão.)");
  }

  // Regista todas as classificações para histórico.
  if (classificacoes.length) {
    const csvPath = path.join(outDir, "_respostas.csv");
    const header = "tipo,email,url,recebidoEm,assunto";
    const linhas = classificacoes.map((c) =>
      [c.tipo, c.email, c.url, c.recebidoEm, c.assunto]
        .map((v) => `"${(v || "").replace(/"/g, '""')}"`)
        .join(",")
    );
    fs.writeFileSync(csvPath, [header, ...linhas].join("\n") + "\n", "utf-8");
    console.log(`✔ Registo escrito em ${csvPath}`);
  }
}

function mostrar(titulo: string, itens: Classificacao[]) {
  console.log(`${titulo}: ${itens.length}`);
  for (const c of itens) {
    console.log(`   • ${c.email} (${c.url}) — "${c.assunto}" [${c.recebidoEm.slice(0, 10)}]`);
  }
  console.log("");
}

main();
