// ส่งอีเมลผ่าน Microsoft Graph (OAuth2 client-credentials)
// token: POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
// send:  POST https://graph.microsoft.com/v1.0/users/{sender}/sendMail

import { config } from "./config.ts";

async function getToken(): Promise<string> {
  const { tenantId, clientId, clientSecret } = config.email;
  const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    signal: AbortSignal.timeout(20000),
  });
  const json: any = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(
      `ขอ token จาก Microsoft ไม่สำเร็จ: ${json.error ?? res.status} - ${json.error_description ?? ""}`,
    );
  }
  return json.access_token as string;
}

export interface SendMailInput {
  subject: string;
  html: string;
  to: string[];
  cc?: string[];
  attachments?: { name: string; contentType: string; contentBase64: string }[];
}

export interface SendMailResult {
  sent: boolean;
  reason?: string;
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  if (!config.email.sendEnabled) {
    return { sent: false, reason: "EMAIL_SEND_ENABLED=false (โหมดทดสอบ ยังไม่ส่งจริง)" };
  }

  const token = await getToken();
  const recipients = (addrs: string[]) =>
    addrs.map((a) => ({ emailAddress: { address: a } }));

  const message: any = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.html },
    toRecipients: recipients(input.to),
  };
  if (input.cc?.length) message.ccRecipients = recipients(input.cc);
  if (input.attachments?.length) {
    message.attachments = input.attachments.map((a) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: a.name,
      contentType: a.contentType,
      contentBytes: a.contentBase64,
    }));
  }

  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.email.sender)}/sendMail`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
    signal: AbortSignal.timeout(30000),
  });

  if (res.status === 202) return { sent: true };
  const txt = await res.text().catch(() => "");
  throw new Error(`ส่งเมลผ่าน Graph ไม่สำเร็จ: HTTP ${res.status} ${txt}`);
}
