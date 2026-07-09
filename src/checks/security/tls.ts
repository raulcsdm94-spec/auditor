import { RegisteredCheck, Finding, CrawlResult } from "../../types";

/** Protocolos considerados obsoletos/inseguros. */
const PROTOCOLOS_FRACOS = ["SSL 3", "SSL 2", "TLS 1.0", "TLS 1.1"];

/**
 * Verifica a ligação TLS: uso de HTTPS, validade do certificado e
 * protocolo negociado. (As cifras concretas não são expostas pelo
 * Playwright; sinalizamos o protocolo, que é o indicador prático.)
 */
const check: RegisteredCheck = {
  id: "sec.tls",
  categoria: "seguranca",
  titulo: "TLS/SSL: HTTPS, validade do certificado e protocolo",
  run(crawl: CrawlResult): Finding[] {
    const findings: Finding[] = [];
    const { tls } = crawl;

    if (!tls.isHttps) {
      findings.push({
        id: "sec.tls.no-https",
        categoria: "seguranca",
        severidade: "critico",
        descricao: "O site não é servido sobre HTTPS.",
        evidencia: `URL final: ${crawl.finalUrl}`,
        remediacao:
          "Instalar um certificado TLS válido e forçar redirecionamento de HTTP para HTTPS.",
      });
      return findings; // sem TLS, o resto não se aplica
    }

    // Protocolo antigo
    if (tls.protocol) {
      const fraco = PROTOCOLOS_FRACOS.some((p) =>
        tls.protocol!.toUpperCase().includes(p.toUpperCase())
      );
      if (fraco) {
        findings.push({
          id: "sec.tls.protocolo-fraco",
          categoria: "seguranca",
          severidade: "alto",
          descricao: `A ligação negociou um protocolo obsoleto (${tls.protocol}).`,
          evidencia: `Protocolo: ${tls.protocol}`,
          remediacao: "Desativar SSLv3/TLS 1.0/1.1 e exigir TLS 1.2 ou superior.",
        });
      }
    } else {
      findings.push({
        id: "sec.tls.protocolo-desconhecido",
        categoria: "seguranca",
        severidade: "info",
        descricao: "Não foi possível determinar o protocolo TLS negociado.",
      });
    }

    // Validade do certificado
    const agora = Date.now() / 1000;
    if (tls.validTo !== undefined) {
      if (tls.validTo < agora) {
        findings.push({
          id: "sec.tls.cert-expirado",
          categoria: "seguranca",
          severidade: "critico",
          descricao: "O certificado TLS está expirado.",
          evidencia: `Válido até: ${new Date(tls.validTo * 1000).toISOString()}`,
          remediacao: "Renovar o certificado imediatamente.",
        });
      } else {
        const diasRestantes = Math.floor((tls.validTo - agora) / 86400);
        if (diasRestantes <= 15) {
          findings.push({
            id: "sec.tls.cert-a-expirar",
            categoria: "seguranca",
            severidade: "medio",
            descricao: `O certificado TLS expira em ${diasRestantes} dia(s).`,
            evidencia: `Válido até: ${new Date(tls.validTo * 1000).toISOString()}`,
            remediacao: "Configurar renovação automática (ex. ACME/Let's Encrypt).",
          });
        }
      }
    }

    if (tls.validFrom !== undefined && tls.validFrom > agora) {
      findings.push({
        id: "sec.tls.cert-ainda-nao-valido",
        categoria: "seguranca",
        severidade: "alto",
        descricao: "O certificado ainda não é válido (data de início no futuro).",
        evidencia: `Válido a partir de: ${new Date(tls.validFrom * 1000).toISOString()}`,
      });
    }

    if (findings.length === 0) {
      findings.push({
        id: "sec.tls.ok",
        categoria: "seguranca",
        severidade: "info",
        descricao: "HTTPS ativo com certificado válido e protocolo moderno.",
        evidencia: `Protocolo: ${tls.protocol ?? "?"}; Emissor: ${tls.issuer ?? "?"}`,
      });
    }

    return findings;
  },
};

export default check;
