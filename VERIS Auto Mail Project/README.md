# VERIS Auto Mail Project

Drop a CSV of leads here, run one command, and it audits every site and sends the outreach emails.

## 0. Import scraped leads (optional, recommended)

If your leads come from the scraper (`Extractor/emails.csv`), don't hand-copy them.
From the `auditor/` folder:

```
npm run leads              # preview: shows what's new vs. already-contacted/suppressed
npm run leads -- --apply   # appends only the NEW leads to leads.csv
```

It reshapes the scraper's `website;email;…` format into `websites,emails`, and skips
anything already in `leads.csv`, already emailed (`_sent-log.json`), or on the opt-out
list (`_supressao.txt`). A business you've already contacted or removed can never
re-enter through a fresh scrape. The preview is also a good place to spot junk the
scraper grabbed (e.g. `user@domain.com`) before it lands in `leads.csv`.

## 1. Put your leads in the CSV

Edit `leads.csv` (already here). Two columns:

```csv
websites,emails
https://exemplo.pt,geral@exemplo.pt
https://outro-site.com,contacto@outro-site.com
```

- One row per business. Header names `websites` / `emails` are auto-detected (a few variants like `site`/`url`/`mail` also work).
- You can edit this file freely between runs. Only rows you haven't emailed before get sent (a sent-log prevents duplicates).

## 2. Preview (safe — sends nothing)

From the `auditor/` folder:

```
npm run automail
```

This audits all sites in the CSV, writes the reports into `reports/` here, and shows a **dry-run** of exactly which emails would go out. Nothing is sent.

## 3. Send for real

```
npm run automail -- --send
```

Same thing, but actually sends each email (subject + body + that site's `VERIS_Relatorio_<Empresa>.pdf`) via Microsoft Graph.

### Recommended first real send

Test with a single lead before trusting the whole batch:

```
npm run automail -- --send --limit 1
```

Confirm it lands in the recipient's inbox and in your Sent folder, then run the full batch.

## Handy flags

- `--limit 5` — only process the first 5 eligible leads (audit + send).
- `--max-per-day 30` — cap real sends per day (default 30).
- `--no-audit` — skip auditing, just (re)send from reports already generated here.
- `--csv other.csv` — use a specific CSV if you keep more than one here.

## After sending: triage replies, opt-outs & bounces

```
npm run inbox                 # report only — reads your inbox, cross-checks the sent-log
npm run inbox -- --apply      # also adds opt-outs/bounces to _supressao.txt + writes _respostas.csv
```

Reads the sending mailbox via Microsoft Graph and sorts what came back into
**replies** (leads to follow up / fulfill), **opt-outs** (someone asked to be
removed), and **bounces** (dead addresses). It's read-only — never marks messages
read, moves, or deletes them. With `--apply`, opt-outs and bounces are appended to
`_supressao.txt` automatically, so they're never contacted again.

> Needs the **Mail.Read** application permission on the Azure app registration
> (you already have Mail.Send for sending). Without it, Graph returns 403 and the
> command prints the exact steps to grant it.

## Opt-out / never-contact list

`_supressao.txt` (here, next to `leads.csv`) is the never-contact list. When someone
replies asking to be removed, add one line — their email or their whole domain:

```
info@naoquerem.pt
outrodominio.com
```

From then on, both the sender and the draft generator skip that lead **for good**,
even if the site reappears in `leads.csv`. Lines starting with `#` are comments.

## What lands in this folder

- `leads.csv` — yours to edit.
- `_supressao.txt` — yours to edit: businesses to never contact (opt-out).
- `reports/` — generated: one subfolder per site (with `VERIS_Relatorio_<Empresa>.pdf`), plus
  `_resumo-auditorias.csv`, `_sent-log.json` (who's been emailed), and `_send-results-*.csv`.
