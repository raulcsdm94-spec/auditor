# VERIS Auto Mail Project

Drop a CSV of leads here, run one command, and it audits every site and sends the outreach emails.

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

## What lands in this folder

- `leads.csv` — yours to edit.
- `reports/` — generated: one subfolder per site (with `VERIS_Relatorio_<Empresa>.pdf`), plus
  `_resumo-auditorias.csv`, `_sent-log.json` (who's been emailed), and `_send-results-*.csv`.
