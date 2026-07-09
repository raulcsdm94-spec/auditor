import * as fs from "fs";
import * as path from "path";

/** Lê um .env simples (KEY=VALUE por linha) e preenche process.env sem sobrepor o que já lá está. */
export function loadEnv(file = ".env"): void {
  const p = path.resolve(process.cwd(), file);
  if (!fs.existsSync(p)) return;

  for (const linha of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
    const l = linha.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i === -1) continue;
    const key = l.slice(0, i).trim();
    let val = l.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
