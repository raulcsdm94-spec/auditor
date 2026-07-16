/**
 * VERIS — Tracker de Auditorias (Google Apps Script Web App)
 * ==========================================================
 * Recebe uma linha do auditor (via `npm run sync`), carrega os ficheiros do
 * relatório para uma pasta partilhada do Drive e faz UPSERT da linha na folha.
 * Chave da linha = URL (coluna B), por isso re-correr o mesmo lead ATUALIZA a
 * linha em vez de duplicar.
 *
 * SETUP (uma vez) — ver SHEET-TRACKER.md:
 *   1. Numa Google Sheet nova (partilhada com o cofundador), abre
 *      Extensions → Apps Script e cola este ficheiro inteiro.
 *   2. Cria uma pasta no Drive (partilhada) para os ficheiros e mete o ID abaixo.
 *   3. Deploy → New deployment → Web app
 *        Execute as: Me   ·   Who has access: Anyone
 *      Copia o URL /exec para SHEET_TRACKER_WEBHOOK_URL no .env do auditor.
 */

// Pasta do Drive onde ficam os ficheiros dos relatórios.
// OPCIONAL: se deixares FOLDER_ID vazio, o script cria/usa uma pasta com o nome
// FOLDER_NAME no teu "My Drive" — depois é só partilhá-la com o cofundador.
// Se preferires uma pasta específica, mete aqui o ID dela (a parte do URL
// depois de /folders/).
var FOLDER_ID = "";
var FOLDER_NAME = "VERIS — Relatórios";

// Nome da tab onde escrevemos.
var SHEET_NAME = "Auditorias";

var HEADERS = [
  "Data",                    // 1  A
  "URL",                     // 2  B  (chave do upsert)
  "Email",                   // 3  C
  "Assunto (cold-call)",     // 4  D
  "Email cold-call (texto)", // 5  E
  "Aprovado p/ envio",       // 6  F  (checkbox — só humanos editam; o sync nunca lhe toca)
  "Email enviado",           // 7  G
  "Data envio",              // 8  H
  "Relatório cliente",       // 9  I
  "Relatório completo",      // 10 J
  "Screenshot",              // 11 K
  "Notas",                   // 12 L
];

// Coluna do checkbox de aprovação (1-based).
var COL_APROVADO = 6;

// Bump este marcador sempre que mudares o layout, para confirmar (via GET) que
// o deployment está mesmo a servir o código novo.
var VERSION = "cols12-aprovar-2026-07-15";

function doGet(e) {
  var action = e && e.parameter && e.parameter.action;
  if (action === "aprovados") return json_(listarAprovados_());
  return json_({ ok: true, service: "veris-tracker", version: VERSION });
}

/** Devolve os URLs com o checkbox "Aprovado p/ envio" marcado. O web app corre
 *  como o dono, por isso lê a folha sem a tornar pública. */
function listarAprovados_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { ok: true, aprovados: [] };
  var n = sheet.getLastRow() - 1;
  var urls = sheet.getRange(2, 2, n, 1).getValues(); // coluna B (URL)
  var aprov = sheet.getRange(2, COL_APROVADO, n, 1).getValues();
  var out = [];
  for (var i = 0; i < n; i++) {
    var v = aprov[i][0];
    var marcado = v === true || String(v).toLowerCase() === "sim" || String(v).toLowerCase() === "true";
    var u = String(urls[i][0]).trim();
    if (marcado && u) out.push(u);
  }
  return { ok: true, aprovados: out };
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();

    // Upload dos ficheiros (se vierem) → links do Drive por slot.
    var links = {};
    if (data.ficheiros && data.ficheiros.length) {
      var folder = getLeadFolder_(data.lead || data.url);
      for (var i = 0; i < data.ficheiros.length; i++) {
        var f = data.ficheiros[i];
        if (f && f.dataBase64 && f.slot) {
          links[f.slot] = upsertFile_(folder, f.nome, f.mime, f.dataBase64);
        }
      }
    }

    upsertRow_(sheet, data, links);
    return json_({ ok: true, links: links });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  // Migração automática: se o cabeçalho não corresponder ao layout atual (ex.
  // colunas antigas), limpa tudo e reconstrói. O re-sync volta a preencher as
  // linhas a partir do resumo, por isso fica uma folha limpa só com as colunas
  // desejadas — sem apagar colunas à mão.
  var precisaReset = sheet.getLastRow() === 0;
  if (!precisaReset) {
    var atualHeader = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    var larguraAntiga = sheet.getLastColumn() !== HEADERS.length;
    for (var c = 0; c < HEADERS.length; c++) {
      if (String(atualHeader[c]).trim() !== HEADERS[c]) { precisaReset = true; break; }
    }
    if (larguraAntiga) precisaReset = true;
  }
  if (precisaReset) {
    sheet.clear();
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(5, 460); // "Email cold-call (texto)" mais larga para rever
  }
  return sheet;
}

/** Pasta-raiz partilhada: usa FOLDER_ID se estiver definido, senão cria/usa
 *  FOLDER_NAME no My Drive. Evita o erro de um ID inválido/placeholder. */
function getRootFolder_() {
  if (FOLDER_ID && FOLDER_ID.indexOf("COLE_AQUI") === -1) {
    return DriveApp.getFolderById(FOLDER_ID);
  }
  var it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function getLeadFolder_(lead) {
  var root = getRootFolder_();
  var name = String(lead || "lead").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function upsertFile_(folder, nome, mime, dataBase64) {
  var old = folder.getFilesByName(nome);
  while (old.hasNext()) old.next().setTrashed(true);
  var blob = Utilities.newBlob(Utilities.base64Decode(dataBase64), mime, nome);
  var file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/**
 * UPSERT com merge: só escreve uma célula quando o payload traz esse campo
 * (não-vazio). Assim um sync pós-envio (--no-files, sem email/ficheiros) só
 * mexe no "Email enviado"/"Data envio"/"Estado" e preserva links e texto já lá.
 */
function upsertRow_(sheet, data, links) {
  var key = String(data.url || "").trim();
  var lastRow = sheet.getLastRow();
  var lastCol = HEADERS.length;

  var rowIndex = -1;
  if (lastRow >= 2) {
    var urls = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // coluna B
    for (var r = 0; r < urls.length; r++) {
      if (String(urls[r][0]).trim() === key) { rowIndex = r + 2; break; }
    }
  }
  var novo = rowIndex === -1;
  if (novo) rowIndex = lastRow < 1 ? 2 : lastRow + 1;

  var atual = novo
    ? new Array(lastCol).fill("")
    : sheet.getRange(rowIndex, 1, 1, lastCol).getValues()[0];

  // Escreve `valor` na coluna `c` (1-based) se estiver definido/não-vazio.
  function set(c, valor) {
    if (valor === undefined || valor === null || valor === "") return;
    atual[c - 1] = valor;
  }
  function setLink(c, url, rotulo) {
    if (!url) return;
    atual[c - 1] = '=HYPERLINK("' + url + '";"' + rotulo + '")';
  }

  set(1, data.data);
  set(2, key);
  set(3, data.email);
  set(4, data.assunto);
  set(5, data.emailTexto);
  // col 6 "Aprovado p/ envio" — NÃO tocar: é o checkbox que o humano marca.
  set(7, data.emailEnviado);
  set(8, data.dataEnvio);
  setLink(9, links.cliente, "Abrir PDF");
  setLink(10, links.completo, "Abrir");
  setLink(11, links.screenshot, "Ver");
  set(12, data.notas);

  sheet.getRange(rowIndex, 1, 1, lastCol).setValues([atual]);

  // Garante um checkbox na célula de aprovação (sem alterar o valor já lá).
  var celulaAprov = sheet.getRange(rowIndex, COL_APROVADO);
  if (celulaAprov.getDataValidation() == null) {
    celulaAprov.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  }
}

function isNum_(v) {
  return typeof v === "number" && !isNaN(v);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
