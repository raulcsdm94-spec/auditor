/** Separa o "Assunto:" do corpo no ficheiro email-outreach.txt. */
export function parseEmailFile(txt: string): { subject: string; body: string } {
  const linhas = txt.split(/\r?\n/);
  let subject = "";
  let i = 0;
  if (linhas[0] && linhas[0].toLowerCase().startsWith("assunto:")) {
    subject = linhas[0].slice(linhas[0].indexOf(":") + 1).trim();
    i = 1;
  }
  while (i < linhas.length && linhas[i].trim() === "") i++;
  const body = linhas.slice(i).join("\n").trimEnd();
  return { subject, body };
}
