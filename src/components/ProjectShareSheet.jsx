import { useEffect, useState } from 'react';
import { changeProjectMemberRole, getProjectMembers, inviteProjectMember, offerProjectTransfer, removeProjectMember, revokeProjectInvite } from '../lib/projectCollaboration';
import { friendlyError } from '../lib/errors';

const ROLE_LABELS = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' };

export default function ProjectShareSheet({ projectId, open, onClose }) {
  const [data, setData] = useState(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');

  const load = async () => {
    if (!projectId || !open) return;
    try { setError(''); setData(await getProjectMembers(projectId)); } catch (e) { setError(friendlyError(e)); }
  };
  useEffect(() => { load(); }, [projectId, open]);

  if (!open) return null;
  const members = data?.members || [];
  const pending = data?.pendingInvites || [];
  const cap = data?.memberCap ?? 2;
  const used = data?.memberCount ?? members.filter((m) => m.role !== 'owner').length;
  const currentRole = data?.currentRole || 'viewer';
  const canInvite = currentRole === 'owner' || currentRole === 'editor';

  const invite = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError(''); setInviteLink(''); setInviteStatus('');
    try {
      const result = await inviteProjectMember(projectId, email.trim(), role);
      setInviteLink(result.inviteLink || '');
      const [localPart, domain = ''] = email.trim().split('@');
      const maskedEmail = localPart && domain ? `${localPart.slice(0, 2)}•••@${domain}` : 'that address';
      setInviteStatus(result.emailSent ? `Invitation emailed to ${maskedEmail}` : 'Email could not be sent, copy the link below');
      setEmail('');
      await load();
    } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const updateRole = async (userId, nextRole) => {
    setBusy(true); setError('');
    try { await changeProjectMemberRole(projectId, userId, nextRole); await load(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const remove = async (userId) => {
    setBusy(true); setError('');
    try { await removeProjectMember(projectId, userId); await load(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  const transfer = async (userId) => {
    if (!window.confirm('Offer ownership of this project to this member? You will become an editor when they accept.')) return;
    setBusy(true); setError('');
    try { await offerProjectTransfer(projectId, userId); await load(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };

  return <div className="fixed inset-0 z-[80] bg-black/60 flex items-end md:items-center justify-center p-0 md:p-6" role="dialog" aria-modal="true" aria-label="Share project">
    <div className="w-full max-w-2xl max-h-[90dvh] overflow-auto rounded-t-3xl md:rounded-3xl border border-white/10 bg-kxbg p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-2xl">
      <div className="flex items-center justify-between gap-3 mb-5">
        <div><h2 className="text-lg font-semibold text-white">Share project</h2><p className="text-xs text-kxmist mt-1">Compute and storage are billed to the project owner.</p></div>
        <button type="button" onClick={onClose} className="min-w-11 min-h-11 rounded-full bg-white/5 text-white" aria-label="Close">×</button>
      </div>
      {error && <div className="mb-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</div>}
      {canInvite && <form onSubmit={invite} className="rounded-2xl bg-white/[0.03] p-4 mb-5">
        <div className="text-sm font-medium text-white mb-2">Invite a member</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="name@example.com" className="min-h-11 flex-1 rounded-xl bg-black/20 border border-white/10 px-3 text-white outline-none" />
          <select value={role} onChange={(e) => setRole(e.target.value)} className="min-h-11 rounded-xl bg-black/20 border border-white/10 px-3 text-white"><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
          <button disabled={busy || used + pending.length >= cap} className="min-h-11 rounded-xl px-4 bg-white text-black font-medium disabled:opacity-50">Invite</button>
        </div>
        <div className="text-xs text-kxmist mt-2">{used} of {cap} member slots used. Upgrade the project owner plan for more members.</div>
        {inviteStatus && <p role="status" className="mt-3 text-xs text-kxmist">{inviteStatus}</p>}
        {inviteLink && <div className="mt-2 rounded-xl bg-black/20 p-3 text-xs text-kxmist break-all"><div>Invite link: <span className="text-white">{inviteLink}</span></div><button type="button" onClick={() => navigator.clipboard?.writeText(inviteLink)} className="mt-2 min-h-9 rounded-lg border border-white/10 px-3 text-white">Copy link</button></div>}
      </form>}

      <div className="space-y-2">
        {members.map((member) => <div key={member.userId} className="min-h-14 flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3">
          <div className="min-w-0 flex-1"><div className="text-sm text-white truncate">{member.displayName}</div><div className="text-xs text-kxmist truncate">{member.maskedEmail || 'Member'}</div></div>
          <span className="px-2 py-1 rounded-full bg-white/5 text-xs text-kxmist">{ROLE_LABELS[member.role]}</span>
          {currentRole === 'owner' && member.role !== 'owner' && <>
            <select aria-label={`Change ${member.displayName} role`} value={member.role} onChange={(e) => updateRole(member.userId, e.target.value)} className="min-h-11 rounded-lg bg-black/20 border border-white/10 text-xs text-white px-2"><option value="editor">Editor</option><option value="viewer">Viewer</option></select>
            <button type="button" onClick={() => transfer(member.userId)} className="min-h-11 px-2 text-xs text-white rounded-lg hover:bg-white/5">Transfer</button>
          </>}
          {member.userId === data?.currentUserId && member.role !== 'owner' && <button type="button" onClick={() => remove(member.userId)} className="min-h-11 px-2 text-xs text-red-200">Leave</button>}
          {currentRole === 'owner' && member.role !== 'owner' && <button type="button" onClick={() => remove(member.userId)} className="min-h-11 px-2 text-xs text-red-200">Remove</button>}
        </div>)}
      </div>

      {pending.length > 0 && <div className="mt-6"><h3 className="text-sm font-medium text-white mb-2">Pending invitations</h3>{pending.map((invite) => <div key={invite.id} className="min-h-14 flex items-center gap-3 rounded-xl border border-white/5 px-3 mb-2"><div className="flex-1 min-w-0"><div className="text-sm text-white truncate">{invite.maskedEmail}</div><div className="text-xs text-kxmist">{ROLE_LABELS[invite.role]} · expires {new Date(invite.expiresAt).toLocaleDateString()}</div></div><button type="button" onClick={async () => { await revokeProjectInvite(projectId, invite.id); load(); }} className="min-h-11 px-3 text-xs text-red-200">Revoke</button></div>)}</div>}
    </div>
  </div>;
}
