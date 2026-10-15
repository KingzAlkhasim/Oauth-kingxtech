export interface ProjectInviteEmailInput {
  inviterName: string;
  projectName: string;
  role: 'editor' | 'viewer';
  inviteLink: string;
  expiryDays: number;
}

export function buildProjectInviteLink(token: string, appOrigin: string): string {
  return `${appOrigin.replace(/\\/+$/, '')}/invite/${encodeURIComponent(token)}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] as string);
}

export function buildProjectInviteEmail(input: ProjectInviteEmailInput): { subject: string; html: string; text: string } {
  const inviter = escapeHtml(input.inviterName);
  const project = escapeHtml(input.projectName);
  const role = input.role === 'editor' ? 'Editor' : 'Viewer';
  const link = escapeHtml(input.inviteLink);
  const subject = `${input.inviterName} invited you to collaborate on ${input.projectName}`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Project invitation · KingxTech</title></head>
<body style="margin:0;padding:0;background:#09090B;color:#F4F4F5;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#09090B;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#111114;border:1px solid #27272A;border-radius:16px;">
<tr><td align="center" style="padding:28px 24px 12px;"><img src="https://auth.kingxtech.name.ng/email/logo.png" srcset="https://auth.kingxtech.name.ng/email/logo@2x.png 2x" width="60" alt="KingxTech" style="display:block;width:60px;height:auto;border:0;"></td></tr>
<tr><td style="padding:12px 28px 28px;font-size:15px;line-height:1.65;color:#D4D4D8;">
<h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#FAFAFA;font-weight:700;">You’re invited to collaborate</h1>
<p style="margin:0 0 16px;"><strong style="color:#FAFAFA;">${inviter}</strong> invited you to collaborate on <strong style="color:#FAFAFA;">${project}</strong> as a ${role}.</p>
<p style="margin:0 0 18px;">This invitation expires in ${input.expiryDays} days.</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#6D28D9" style="border-radius:10px;background:#6D28D9;"><a href="${link}" style="display:inline-block;padding:13px 22px;border-radius:10px;color:#FFFFFF;font-size:15px;line-height:1.2;font-weight:700;text-decoration:none;">Accept invitation</a></td></tr></table>
<p style="margin:0 0 8px;color:#A1A1AA;font-size:12px;">If the button doesn’t work, copy and paste this link into your browser:</p>
<p style="margin:0 0 20px;overflow-wrap:anywhere;word-break:break-word;font-size:12px;"><a href="${link}" style="color:#A5B4FC;text-decoration:underline;">${link}</a></p>
<p style="margin:0 0 20px;">If you weren’t expecting this invitation, you can ignore this email.</p>
<p style="margin:0;color:#A1A1AA;font-size:12px;">KingxTech · Questions? Contact <a href="mailto:hello@kingxtech.name.ng" style="color:#C4B5FD;text-decoration:underline;">hello@kingxtech.name.ng</a></p>
</td></tr></table><p style="margin:16px 0 0;color:#71717A;font-size:11px;line-height:1.5;text-align:center;">Sent by KingxTech</p>
</td></tr></table></body></html>`;
  const text = [
    `${input.inviterName} invited you to collaborate on ${input.projectName} as a ${role}.`,
    `This invitation expires in ${input.expiryDays} days.`,
    '',
    'Accept the invitation using this link:',
    input.inviteLink,
    '',
    'If you were not expecting this invitation, you can ignore this email.',
    'KingxTech · Questions? Contact hello@kingxtech.name.ng',
  ].join('\\n');
  return { subject, html, text };
}
