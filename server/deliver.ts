import {
  SESv2Client,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";

const SES_REGION =
  process.env.SES_REGION || process.env.BEDROCK_REGION || "us-east-1";

const ses = new SESv2Client({ region: SES_REGION });

/** Escape the five HTML-significant characters. Digest content is derived from
 * untrusted feed titles/URLs, so every interpolated string goes through this. */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the plain-text digest into a minimal inline-styled HTML email. Lines
 * starting with '## ' become section headers; legend lines of the form
 * '[n] title — url' become anchor links; everything else is a paragraph. Every
 * piece of digest-derived text is HTML-escaped (titles are untrusted).
 */
function renderHtml(content: string): string {
  const lines = content.split("\n");
  const parts: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("## ")) {
      parts.push(
        `<h3 style="font-family:Arial,sans-serif;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#1a1a1a;margin:20px 0 8px;">${escapeHtml(line.slice(3))}</h3>`,
      );
      continue;
    }
    const legendMatch = line.match(/^(\[\d+\])\s+(.*?)\s+—\s+(\S+)$/);
    if (legendMatch) {
      const [, marker, title, url] = legendMatch;
      const safeUrl = /^https?:\/\//i.test(url) ? url : "";
      const label = `${escapeHtml(marker)} ${escapeHtml(title)}`;
      parts.push(
        safeUrl
          ? `<p style="font-family:Arial,sans-serif;font-size:12px;color:#555;margin:2px 0;">${escapeHtml(marker)} <a href="${escapeHtml(safeUrl)}" style="color:#2563eb;">${escapeHtml(title)}</a></p>`
          : `<p style="font-family:Arial,sans-serif;font-size:12px;color:#555;margin:2px 0;">${label}</p>`,
      );
      continue;
    }
    // Body paragraph. Escape first (titles are untrusted), then promote
    // **bolded** spans — the per-item "Why it matters" implication — to
    // <strong>. The captured span is already escaped, so this is XSS-safe.
    const escaped = escapeHtml(line).replace(
      /\*\*([^*]+)\*\*/g,
      "<strong>$1</strong>",
    );
    parts.push(
      `<p style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222;margin:8px 0;">${escaped}</p>`,
    );
  }
  return `<div style="max-width:640px;margin:0 auto;padding:16px;">${parts.join("")}</div>`;
}

/** Send the digest via SES. Returns false on any failure (never throws). An
 * explicit subject (the brief's reviewed headline) overrides the dated default. */
async function deliverViaSes(content: string, subject?: string): Promise<boolean> {
  const to = process.env.DIGEST_EMAIL_TO;
  if (!to) return false;
  const from = process.env.DIGEST_EMAIL_FROM || to;
  const date = new Date().toISOString().slice(0, 10);
  // Collapse any CR/LF so a subject can never inject an extra email header.
  const subjectLine =
    (subject?.replace(/[\r\n]+/g, " ").trim() || `AI NOC Daily Digest — ${date}`).slice(0, 200);
  try {
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: from,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subjectLine },
            Body: {
              Text: { Data: content },
              Html: { Data: renderHtml(content) },
            },
          },
        },
      }),
    );
    return true;
  } catch (err) {
    console.error("[Deliver] SES send failed:", (err as Error).message);
    return false;
  }
}

/** POST the digest to the configured webhook. Discord and everything-else use
 * different JSON shapes. Never logs the URL (it carries a secret token). */
async function deliverViaWebhook(content: string): Promise<boolean> {
  const url = process.env.DIGEST_WEBHOOK_URL;
  if (!url) return false;
  try {
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      console.error("[Deliver] Webhook URL is not a valid URL");
      return false;
    }
    const isDiscord = host.endsWith("discord.com");
    const payload = isDiscord
      ? { content: content.slice(0, 1900) }
      : { text: content };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[Deliver] Webhook POST failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Deliver] Webhook POST failed:", (err as Error).message);
    return false;
  }
}

/**
 * Deliver the digest to every configured channel: SES (primary, when
 * DIGEST_EMAIL_TO is set) and the optional webhook (secondary, when
 * DIGEST_WEBHOOK_URL is set). Returns true if at least one channel succeeded.
 */
export async function deliverDigest(content: string, subject?: string): Promise<boolean> {
  const [sesOk, webhookOk] = await Promise.all([
    deliverViaSes(content, subject),
    deliverViaWebhook(content),
  ]);
  return sesOk || webhookOk;
}
