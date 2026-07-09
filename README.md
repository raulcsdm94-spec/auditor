# website-auditor

Ferramenta de **auditoria passiva** de websites para consultoria de
cibersegurança e conformidade legal, focada em PME em **Portugal** e **Espanha**.

Carrega o site num browser headless (Playwright), segue alguns links internos
relevantes (políticas, contacto, login, checkout…), recolhe HTML, headers,
cookies, pedidos de rede, TLS, métricas de acessibilidade e registos DNS, corre
um conjunto modular de verificações de **segurança** e **conformidade legal**, e
gera **dois relatórios** ordenados por severidade (Markdown + PDF):

- **Interno** (`relatorio.*`) — completo, com a **remediação** (o "como corrigir").
- **Cliente** (`relatorio-cliente.*`) — só o diagnóstico (problema + evidência +
  **risco/impacto**), **sem** os passos de correção. A correção é o serviço pago.

> ⚠️ **Uso autorizado apenas.** Este é um scanner *passivo*: lê apenas conteúdo
> publicamente acessível. **Não** faz brute-force, scanning de portas, fuzzing,
> nem qualquer exploração ativa. Obtenha sempre consentimento por escrito do
> cliente antes de auditar um site. As verificações legais são **indicativas**
> e não substituem aconselhamento jurídico.

---

## Requisitos

- Node.js 18+
- Sistema com dependências do Chromium (o `postinstall` corre `playwright install chromium`)

## Instalação

```bash
cd website-auditor
npm install        # instala dependências + browser do Playwright
```

Se o download do browser for bloqueado, corra manualmente:

```bash
npx playwright install chromium
```

## Utilização

```bash
# Modo de desenvolvimento (ts-node)
npm run audit -- --url https://exemplo.com --country pt

# Ou compilado
npm run build
npm run audit:prod -- --url https://exemplo.com --country pt
```

Os relatórios são escritos em `reports/<dominio>_<timestamp>/`:

- `relatorio.md` / `relatorio.pdf` — relatório **interno** (VERIS), com remediação
- `relatorio-cliente.md` / `relatorio-cliente.pdf` — relatório do **cliente**, sem passos de correção
- `screenshot.png` — captura da página inicial

### Opções da CLI

| Opção | Descrição | Default |
| --- | --- | --- |
| `--url <url>` | URL a auditar (**obrigatório**) | — |
| `--country <code>` | Ruleset legal: `pt` ou `es` | `pt` |
| `--out <dir>` | Diretório de saída | `reports` |
| `--ecommerce` | Forçar classificação como loja online | auto |
| `--booking` | Forçar classificação como site de reservas | auto |
| `--cliente-only` | Gerar apenas o relatório do cliente | gera ambos |
| `--interno-only` | Gerar apenas o relatório interno completo | gera ambos |
| `--max-pages <n>` | Nº máximo de páginas (principal + subpáginas) | `5` |
| `--single-page` | Analisar só a página indicada (não seguir links) | segue |
| `--no-dns` | Não resolver DNS (salta SPF/DMARC/CAA) | resolve |
| `--no-pdf` | Gerar apenas Markdown | gera PDF |
| `--no-screenshot` | Não capturar screenshot | captura |
| `--timeout <ms>` | Timeout de navegação | `30000` |

`--cliente-only` e `--interno-only` são mutuamente exclusivos.

O processo termina com código `2` se houver problemas **críticos**, `1` se
houver **altos**, e `0` caso contrário — útil para integração em CI.

---

## Os dois relatórios

Cada execução gera, por omissão, **dois** relatórios na mesma pasta:

- **Interno (`relatorio.*`)** — completo, **igual ao histórico**: cada finding traz
  `Evidência` e `Remediação` (o passo de correção). É a base de trabalho da equipa.
- **Cliente (`relatorio-cliente.*`)** — diagnóstico para enviar ao prospeto: mostra
  `Evidência` e uma frase de **`Risco`** (impacto/porquê importa), **nunca** a
  remediação. Termina com uma secção "Próximo passo" que convida a contratar a VERIS
  para as correções. Sem avisos técnicos de crawl.

O texto de **risco** mostrado ao cliente está **centralizado** em
[`src/report/markdown.ts`](src/report/markdown.ts) (`RISCO_POR_ID` para ids exatos,
`RISCO_POR_PREFIXO` para ids dinâmicos, e um genérico por categoria). Um check pode
também definir `risco` diretamente num `Finding` para sobrepor o texto central.

---

## Arquitetura

```
src/
  types.ts              # contrato partilhado (Finding, CrawlResult, DnsInfo, A11yInfo, …)
  crawler/crawl.ts      # multi-página + screenshot + DNS + métricas de acessibilidade
  checks/
    index.ts            # registo central de checks + heurísticas + ruleset
    security/           # uma verificação de segurança por ficheiro
      tls.ts headers.ts cookies.ts exposure.ts fingerprinting.ts login-forms.ts
      mixed-content.ts csp.ts sri.ts email-dns.ts
    legal/              # uma verificação legal por ficheiro
      _shared.ts livro-reclamacoes.ts politicas.ts banner-cookies.ts
      info-empresa.ts ecommerce.ts reservas.ts trackers.ts acessibilidade.ts
  rules/legal/          # rulesets configuráveis por país (JSON)
    pt-PT.json es-ES.json
  report/
    markdown.ts         # Markdown + resumo executivo + mapa central de RISCO (cliente)
    pdf.ts              # Markdown -> HTML -> PDF (Chromium do Playwright)
    index.ts            # gera os relatórios interno + cliente e escreve os ficheiros
  cli.ts                # ponto de entrada
```

**Cobertura dos checks:**

- **Segurança:** TLS/certificado, headers de segurança, flags de cookies, exposição de
  caminhos sensíveis, fingerprinting de CMS/versões, formulários de login, **conteúdo
  misto**, **qualidade da CSP**, **SRI**, e **segurança de email/domínio** (SPF, DMARC,
  MX, CAA via DNS).
- **Legal/privacidade:** consentimento de cookies, políticas, livro de reclamações,
  informação da empresa, deveres de e-commerce/reservas, **trackers de terceiros +
  transferência internacional de dados** (RGPD/Schrems II), e **acessibilidade básica**
  (WCAG / Ato Europeu da Acessibilidade).

O crawler segue até `--max-pages` links internos relevantes (políticas, contacto,
login, checkout) e agrega a evidência, melhorando sobretudo a deteção legal.

**Fluxo:** `cli` → `crawl()` produz um `CrawlResult` → `correrChecks()` passa
esse resultado a cada check, que devolve `Finding[]` → `gerarRelatorio()` agrega
e escreve Markdown + PDF.

Um **`Finding`** tem sempre a forma:

```ts
{ id, categoria, severidade, descricao, evidencia?, remediacao?, risco? }
// categoria  = "seguranca" | "legal"
// severidade = "critico" | "alto" | "medio" | "info"
// remediacao = só no relatório interno (o "como corrigir")
// risco      = frase de impacto para o cliente; se omitida, usa o mapa central
```

---

## Como adicionar um novo check

Cada check é uma função independente que recebe o `CrawlResult` (e o
`CheckContext`) e devolve `Finding[]`. Não acede à rede — trabalha só sobre o
material já recolhido pelo crawler.

1. **Crie o ficheiro** em `src/checks/security/` ou `src/checks/legal/`, ex.
   `src/checks/security/mixed-content.ts`:

   ```ts
   import { RegisteredCheck, Finding, CrawlResult } from "../../types";

   const check: RegisteredCheck = {
     id: "sec.mixed-content",
     categoria: "seguranca",
     titulo: "Conteúdo misto (recursos HTTP em página HTTPS)",
     run(crawl: CrawlResult): Finding[] {
       if (!crawl.tls.isHttps) return [];
       const inseguros = crawl.requests.filter((r) => r.url.startsWith("http://"));
       if (inseguros.length === 0) {
         return [{
           id: "sec.mixed-content.ok", categoria: "seguranca",
           severidade: "info", descricao: "Sem conteúdo misto detetado.",
         }];
       }
       return [{
         id: "sec.mixed-content.encontrado",
         categoria: "seguranca",
         severidade: "medio",
         descricao: `${inseguros.length} recurso(s) carregado(s) sobre HTTP numa página HTTPS.`,
         evidencia: inseguros.slice(0, 5).map((r) => r.url).join("\n"),
         remediacao: "Servir todos os recursos sobre HTTPS.",
       }];
     },
   };

   export default check;
   ```

2. **Registe-o** em [src/checks/index.ts](src/checks/index.ts): importe o ficheiro
   e adicione-o ao array `CHECKS`.

3. Pronto — o relatório passa a incluí-lo automaticamente, ordenado por
   severidade.

**Convenções:**
- `id` em `dominio.area.detalhe` (`sec.*` para segurança, `legal.*` para legal).
- Emita sempre pelo menos um finding (use severidade `info` para o caso "OK").
- Se precisar de dados novos do crawl, acrescente o campo a `CrawlResult` em
  [src/types.ts](src/types.ts) e popule-o em [src/crawler/crawl.ts](src/crawler/crawl.ts).
- Checks condicionais (e-commerce/reservas) leem `ctx.isEcommerce` / `ctx.isBooking`.

---

## Como expandir o ruleset legal para outro país

O módulo legal é orientado por dados: cada país tem um ficheiro JSON em
`src/rules/legal/<código>.json` que segue a interface `LegalRuleset`
(ver [src/types.ts](src/types.ts)). Os checks legais procuram os `patterns`
(texto/links) no conteúdo da página; a `remediacao` é o texto mostrado no
relatório quando o requisito falha.

Para adicionar, por exemplo, **França (`fr-FR`)**:

1. **Copie** `src/rules/legal/pt-PT.json` para `src/rules/legal/fr-FR.json`.

2. **Traduza/adapte** os `patterns` e a `remediacao` à legislação local
   (ex.: em vez de "Livro de Reclamações", os termos e referências legais
   franceses correspondentes; mentions légales, RGPD/CNIL, droit de
   rétractation de 14 dias, etc.).

3. **Mapeie o código de país** em [src/checks/index.ts](src/checks/index.ts), no
   objeto `RULESET_POR_PAIS`:

   ```ts
   const RULESET_POR_PAIS: Record<string, string> = {
     pt: "pt-PT", "pt-pt": "pt-PT",
     es: "es-ES", "es-es": "es-ES",
     fr: "fr-FR", "fr-fr": "fr-FR",   // <-- novo
   };
   ```

4. **Corra**: `npm run audit -- --url https://exemple.fr --country fr`.

Já vêm incluídos **`pt-PT`** (referência principal) e **`es-ES`** (ponto de
partida para Espanha). Se um requisito não se aplicar a um país, deixe a lista de
`patterns` desse requisito vazia (`[]`) — o check trata-o como "não aplicável".

> Os `patterns` são comparados em *lowercase*, sem acentos garantidos — inclua
> variantes com e sem acentos para maior cobertura, como nos ficheiros de exemplo.

---

## Limitações e notas éticas

- A deteção legal é **textual/heurística**: a ausência de uma correspondência
  pode ser falso positivo (ex. texto dentro de imagens ou iframes externos).
  Use os resultados como ponto de partida para revisão humana.
- O check de TLS reporta o protocolo negociado; a enumeração de cifras concretas
  exige ferramentas dedicadas (ex. `testssl.sh`) e está fora do âmbito passivo.
- As sondagens de exposição limitam-se a uma **lista fixa e curta** de caminhos
  públicos bem conhecidos, com um único GET cada. Não há descoberta, wordlists
  nem brute-force.
- Audite **apenas sites para os quais tem autorização explícita**.

## Licença

MIT.
