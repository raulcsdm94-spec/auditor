# Tracker de Auditorias — Google Sheet partilhada

Espelha cada dry-run/envio numa **Google Sheet partilhada** entre ti e o
cofundador. O `_resumo-auditorias.csv` continua a ser a fonte de verdade local;
o sync sobe os ficheiros (PDF do cliente, relatório completo, screenshot) para
uma **pasta partilhada do Drive** e escreve uma linha com contagens, o texto do
email (para rever) e **links clicáveis** — sem paths `/Users/...`.

## Folha de leads partilhada (entrada)

Os leads vêm de uma **Google Sheet partilhada** (`LEADS_SHEET_ID` no `.env`) — tu e o
cofundador adicionam linhas (`websites,emails`) na folha e o `npm run automail`
apanha-as automaticamente (puxa a folha → `leads.csv` antes de auditar). A folha tem
de estar **partilhada como "qualquer pessoa com o link: Leitor"** (ou Ficheiro →
Publicar na Web) para o export CSV funcionar sem login.

- ⚠️ O `leads.csv` local passa a ser um **espelho da folha** — é reescrito a cada run,
  por isso edita os leads **na folha**, não no ficheiro.
- Puxar à mão (para testar): `npm run pull-leads`. Saltar o pull num run: `--no-pull-leads`.
- Ficheiros por lead: sobem 3 para a pasta do Drive (rascunho do email, relatório do
  cliente, relatório interno). Só o **relatório do cliente** tem link na folha; o
  interno fica na pasta para consultar se houver resposta. Screenshot não sobe.
- Já-contactados e opt-outs continuam a ser saltados no envio (via `_sent-log.json` /
  `_supressao.txt`), por isso podes deixar leads antigos na folha sem risco de duplicar.

## Aprovar e enviar a partir da folha

Depois da dry-run, tu/o cofundador revêem cada linha e marcam o checkbox
**"Aprovado p/ envio"** nos que aprovam. Depois envia-se só esses, **sem
re-auditar** (usa os relatórios/emails já gerados):

```
# preview do que ia sair (dry-run):
npm run enviar-aprovados
# enviar a sério:
npm run enviar-aprovados -- --send
```

`enviar-aprovados` = `automail --no-audit --strategy coldcall --so-aprovados`. Lê os
aprovados da folha (via o mesmo webhook do tracker — a folha **não** precisa de ser
pública), envia só esses, e depois sincroniza para virar **Email enviado → Sim**. A
aprovação do humano dispensa a regra de elegibilidade automática; opt-out e
já-enviados continuam a ser respeitados. Se nada estiver aprovado, não envia nada.

## Fluxo de trabalho

1. `npm run automail --strategy coldcall` → audita + preview + **sincroniza a folha** (com ficheiros).
2. O cofundador abre a folha na máquina dele, lê a coluna **Email cold-call (texto)**,
   vê **Pronto a enviar** (Sim / Não+motivo) e **Email enviado** (Sim/Não), confirma.
3. `npm run automail --send --strategy coldcall` → envia + volta a sincronizar (vira **Email enviado → Sim**).

O corpo do email mostrado é **sempre o cold-call** (`email-coldcall.txt`) — é o que
se revê. **Pronto a enviar** usa a mesma regra do `send.ts` (estado ok · ≥1 crítico
ou ≥2 graves · tem email · não está em opt-out · ainda não enviado), por isso diz a
verdade sobre o que sairia num `--send` real.

Também dá para correr o sync à mão: `npm run sync -- --out "VERIS Auto Mail Project/reports" --strategy coldcall`.
Flags úteis: `--dry-run` (mostra sem enviar), `--only <texto>` (só um lead), `--no-files` (só estado/contagens), `--no-screenshot` (payload mais leve).

## Setup (uma vez, ~10 min)

1. **Folha**: cria uma Google Sheet nova (ex. "VERIS — Tracker de Auditorias").
   Partilha com o cofundador como **Editor**.
2. **Pasta do Drive**: cria uma pasta (ex. "VERIS — Relatórios"). Partilha com o
   cofundador. Abre-a e copia o **ID** do URL:
   `https://drive.google.com/drive/folders/<ISTO_É_O_ID>`.
3. **Apps Script**: na folha, `Extensions → Apps Script`. Apaga o que estiver lá,
   cola o conteúdo de [`apps-script/Code.gs`](apps-script/Code.gs) e mete o ID da
   pasta em `FOLDER_ID`. Guarda.
4. **Deploy**: `Deploy → New deployment → tipo Web app`.
   - *Execute as*: **Me**
   - *Who has access*: **Anyone**
   - Autoriza os scopes quando pedir. Copia o **URL /exec**.
5. **`.env` do auditor**: mete o URL em `SHEET_TRACKER_WEBHOOK_URL=` (já lá está
   a linha em branco).

Pronto. A partir daí `npm run automail` sincroniza sozinho. Se o webhook não
estiver definido, o sync é saltado em silêncio (o CSV local gera na mesma).

## Notas

- **Upsert por URL**: re-correr o mesmo lead atualiza a linha, não duplica.
- **Merge seguro**: o sync pós-envio (`--no-files`) só mexe em estado/enviado;
  não apaga links nem o texto do email já na folha.
- Mesmo padrão do tracker da welcome page (`SHEET_WEBHOOK_URL` no site). São dois
  webhooks/folhas diferentes — não confundir.
- Ao mudar o `Code.gs`, faz **Deploy → Manage deployments → edit → Version: New**
  (senão o URL antigo continua a correr a versão velha).
