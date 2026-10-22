import { escapeHtml } from './projectInviteEmail';

const CATEGORY_TEXT: Record<string, string> = {
  malware: 'building or hosting malware or tools that harm other people’s devices',
  phishing: 'building pages that imitate other services or collect people’s credentials',
  fraud: 'building tools that create fake documents or help with fraud',
  hacking: 'building tools to break into accounts or systems you do not own',
  weapons: 'content that helps make weapons',
  child_safety: 'content that endangers children',
  crypto_scam: 'building crypto scams or wallet drainers',
};

export function describeWarningCategory(category: string): string {
  return CATEGORY_TEXT[category] || 'activity that may break our Terms of Service';
}

export interface AbuseWarningEmailInput {
  name: string;
  category: string;
  termsLink: string;
  adminNote?: string;
}

export function buildAbuseWarningEmail(input: AbuseWarningEmailInput): { subject: string; html: string; text: string } {
  const what = describeWarningCategory(input.category);
  const name = escapeHtml(input.name || 'there');
  const note = (input.adminNote || '').trim().slice(0, 500);
  const link = escapeHtml(input.termsLink);
  const subject = 'A warning about your KingxTech account';
  const noteHtml = note ? `<p style="margin:0 0 16px;padding:12px 14px;border:1px solid #27272A;border-radius:10px;background:#0D0D10;color:#E4E4E7;">${escapeHtml(note)}</p>` : '';
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Account warning · KingxTech</title></head>
<body style="margin:0;padding:0;background:#09090B;color:#F4F4F5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#09090B;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#111114;border:1px solid #27272A;border-radius:16px;">
<tr><td align="center" style="padding:28px 24px 12px;"><img src="https://auth.kingxtech.name.ng/email/logo.png" srcset="https://auth.kingxtech.name.ng/email/logo@2x.png 2x" width="60" alt="KingxTech" style="display:block;width:60px;height:auto;border:0;"></td></tr>
<tr><td style="padding:12px 28px 28px;font-size:15px;line-height:1.65;color:#D4D4D8;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#FAFAFA;font-weight:700;">A warning about your account</h1>
<p style="margin:0 0 16px;">Hi ${name},</p>
<p style="margin:0 0 16px;">Our safety checks found activity on your account that looks like ${escapeHtml(what)}. That is not allowed under our <a href="${link}" style="color:#A5B4FC;text-decoration:underline;">Terms of Service</a>.</p>
${noteHtml}<p style="margin:0 0 16px;">Please stop. If it continues, we may take content offline or suspend your account.</p>
<p style="margin:0 0 20px;">If you think this is a mistake, reply to this email or contact us and we will look again.</p>
<p style="margin:0;color:#A1A1AA;font-size:12px;">KingxTech · <a href="mailto:hello@kingxtech.name.ng" style="color:#C4B5FD;text-decoration:underline;">hello@kingxtech.name.ng</a></p>
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    `Hi ${input.name || 'there'},`,
    '',
    `Our safety checks found activity on your account that looks like ${what}. That is not allowed under our Terms of Service: ${input.termsLink}`,
    ...(note ? ['', note] : []),
    '',
    'Please stop. If it continues, we may take content offline or suspend your account.',
    'If you think this is a mistake, reply to this email or contact hello@kingxtech.name.ng and we will look again.',
    '',
    'KingxTech',
  ].join('\n');
  return { subject, html, text };
}
