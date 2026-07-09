import { chromium } from "playwright";

/** Escapa HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Aplica formatação inline (negrito e código) a uma linha já escapada. */
function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

/**
 * Conversor de Markdown -> HTML minimalista, suficiente para o subconjunto
 * de Markdown que o gerador produz (títulos, listas, tabelas, blocos de
 * código, citações). Mantido propositadamente sem dependências externas.
 */
function markdownParaHtml(md: string): string {
  const linhas = md.split("\n");
  const out: string[] = [];
  let i = 0;
  let emLista = false;

  const fecharLista = () => {
    if (emLista) {
      out.push("</ul>");
      emLista = false;
    }
  };

  while (i < linhas.length) {
    const linha = linhas[i];

    // Bloco de código cercado
    if (linha.trimStart().startsWith("```")) {
      fecharLista();
      const buf: string[] = [];
      i++;
      while (i < linhas.length && !linhas[i].trimStart().startsWith("```")) {
        buf.push(esc(linhas[i].replace(/^ {2}/, "")));
        i++;
      }
      i++; // saltar fecho
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // Tabela (linha começa por | e a seguinte é separadora)
    if (linha.trim().startsWith("|") && /^\s*\|[\s:|-]+\|\s*$/.test(linhas[i + 1] || "")) {
      fecharLista();
      const header = linha.split("|").slice(1, -1).map((c) => c.trim());
      i += 2;
      const rows: string[][] = [];
      while (i < linhas.length && linhas[i].trim().startsWith("|")) {
        rows.push(linhas[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      out.push("<table>");
      out.push("<thead><tr>" + header.map((h) => `<th>${inline(h)}</th>`).join("") + "</tr></thead>");
      out.push("<tbody>");
      for (const r of rows) {
        out.push("<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>");
      }
      out.push("</tbody></table>");
      continue;
    }

    const h = /^(#{1,4})\s+(.*)$/.exec(linha);
    if (h) {
      fecharLista();
      const nivel = h[1].length;
      out.push(`<h${nivel}>${inline(h[2])}</h${nivel}>`);
      i++;
      continue;
    }

    if (linha.trimStart().startsWith("> ")) {
      fecharLista();
      out.push(`<blockquote>${inline(linha.trimStart().slice(2))}</blockquote>`);
      i++;
      continue;
    }

    const li = /^\s*-\s+(.*)$/.exec(linha);
    if (li) {
      if (!emLista) {
        out.push("<ul>");
        emLista = true;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      i++;
      continue;
    }

    if (linha.trim() === "") {
      fecharLista();
      i++;
      continue;
    }

    fecharLista();
    out.push(`<p>${inline(linha)}</p>`);
    i++;
  }
  fecharLista();
  return out.join("\n");
}

/** Escudo VERIS (mesmo símbolo do site): preenchimento teal, traço e visto lima. */
const LOGO_SVG = `<svg width="40" height="40" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M16 2.5 27 6.7v8.1c0 7.1-4.6 11.9-11 14.7C9.6 26.7 5 21.9 5 14.8V6.7L16 2.5Z" fill="#06211f" stroke="#c6f24e" stroke-width="1.6"/>
  <path d="m10.8 16.2 3.7 3.7 6.9-7.6" stroke="#c6f24e" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/** Cabeçalho de marca: logótipo + nome no canto superior direito. */
const HEADER_HTML = `
  <div class="veris-header">
    <div class="doc-kicker">Relatório confidencial</div>
    <div class="brand">
      ${LOGO_SVG}
      <div class="name">VERIS</div>
      <div class="url">verisaudit.com</div>
    </div>
  </div>`;

const CSS = `
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
         color: #1b2a26; line-height: 1.55; font-size: 12px; margin: 0; }

  /* Cabeçalho de marca */
  .veris-header { display: flex; justify-content: space-between; align-items: flex-start;
                  padding-bottom: 14px; border-bottom: 2px solid #c6f24e; margin-bottom: 4px; }
  .veris-header .doc-kicker { font-size: 9.5px; letter-spacing: 0.2em; text-transform: uppercase;
                  color: #6a8a82; font-weight: 600; margin-top: 8px; }
  .brand { text-align: center; line-height: 1.15; }
  .brand .name { font-size: 17px; font-weight: 800; letter-spacing: 0.08em; color: #06211f; margin-top: 3px; }
  .brand .url { font-size: 8.5px; letter-spacing: 0.04em; color: #6a8a82; margin-top: 2px; }

  h1 { font-size: 21px; color: #06211f; margin: 16px 0 4px; font-weight: 800; letter-spacing: -0.01em; }
  h2 { font-size: 15px; color: #0b3b3c; margin-top: 26px; padding-bottom: 5px;
       border-bottom: 1px solid #dce6e2; font-weight: 700; }
  h3 { font-size: 12.5px; color: #16302c; margin-top: 16px; margin-bottom: 4px; font-weight: 700; }

  p { margin: 6px 0; }
  strong { color: #06211f; }

  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 11px; }
  th, td { border: 1px solid #d4ded9; padding: 7px 10px; text-align: left; }
  th { background: #0b3b3c; color: #eafff4; font-weight: 600; letter-spacing: 0.02em; }
  tr:nth-child(even) td { background: #f2f7f4; }

  code { background: #eef3f0; padding: 1px 4px; border-radius: 3px;
         font-family: "SFMono-Regular", Consolas, monospace; font-size: 10.5px; color: #14302d; }
  pre { background: #f5f8f6; border: 1px solid #dde7e2; border-radius: 5px; padding: 10px;
        overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  pre code { background: none; padding: 0; }

  blockquote { background: #f4fbe7; border-left: 3px solid #c6f24e; margin: 12px 0;
               padding: 9px 14px; color: #3f4d22; border-radius: 0 4px 4px 0; }

  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 3px 0; }
`;

/** Constrói o documento HTML completo (com marca VERIS) a partir do Markdown. */
export function construirHtmlRelatorio(markdown: string): string {
  return `<!doctype html><html lang="pt"><head><meta charset="utf-8">
    <style>${CSS}</style></head><body>${HEADER_HTML}${markdownParaHtml(markdown)}</body></html>`;
}

/** Renderiza o Markdown como PDF (com marca VERIS) usando o Chromium do Playwright. */
export async function gerarPdf(markdown: string, outPath: string): Promise<void> {
  const html = construirHtmlRelatorio(markdown);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate: `<div style="width:100%; font-size:8px; color:#6a8a82; padding:0 12mm;
        display:flex; justify-content:space-between; align-items:center;">
        <span>VERIS · verisaudit.com</span>
        <span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span>
      </div>`,
      margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
    });
  } finally {
    await browser.close().catch(() => {});
  }
}
