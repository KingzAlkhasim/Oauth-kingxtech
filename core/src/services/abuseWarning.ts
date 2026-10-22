import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabaseAdmin';
import { buildAbuseWarningEmail } from './abuseWarningEmail';

export class WarningError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('admin_users').select('user_id').eq('user_id', userId).maybeSingle();
  return !!data;
}

export async function warnFlagOwner(adminId: string, flagId: string, adminNote?: string) {
  if (!(await isAdminUser(adminId))) throw new WarningError('Not allowed.', 403);
  if (!env.RESEND_API_KEY) throw new WarningError('Email is not set up on the server (RESEND_API_KEY).', 503);

  const { data: flag } = await supabaseAdmin.from('abuse_flags').select('id, user_id, category').eq('id', flagId).maybeSingle();
  if (!flag) throw new WarningError('Flag not found.', 404);

  // Stop double-clicks from sending the same warning twice.
  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: recent } = await supabaseAdmin.from('admin_audit_log').select('id')
    .eq('action', 'abuse.warn').eq('target_id', flagId).gte('created_at', since).limit(1);
  if (recent && recent.length > 0) throw new WarningError('A warning for this flag was just sent.', 429);

  const { data: owner } = await supabaseAdmin.auth.admin.getUserById(flag.user_id as string);
  const to = owner.user?.email;
  if (!to) throw new WarningError('This user has no email address.', 422);
  const meta = owner.user?.user_metadata as Record<string, unknown> | undefined;
  const name = typeof meta?.full_name === 'string' && meta.full_name.trim() ? meta.full_name.trim()
    : typeof meta?.name === 'string' && meta.name.trim() ? meta.name.trim() : '';

  const email = buildAbuseWarningEmail({
    name,
    category: String(flag.category),
    termsLink: `${env.APP_ORIGIN}/terms`,
    adminNote,
  });
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'KingxTech <noreply@kingxtech.name.ng>',
      to: [to],
      reply_to: 'hello@kingxtech.name.ng',
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  }).catch(() => null);
  if (!response || !response.ok) throw new WarningError('The email provider did not accept the message. Try again in a minute.', 502);

  await supabaseAdmin.from('admin_audit_log').insert({
    admin_id: adminId,
    action: 'abuse.warn',
    target_type: 'abuse_flag',
    target_id: flagId,
    details: { user_id: flag.user_id, category: flag.category, note: adminNote?.trim().slice(0, 500) || null },
  });
  return { sent: true };
}
