import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Crown, Mail, Shield, UserMinus, Users, X } from 'lucide-react';
import DashboardShell from '../components/DashboardShell';
import { Badge, Button, Card, Input } from '../components/ui';
import useRequireAuth from '../lib/useRequireAuth';
import useSeo from '../lib/useSeo';
import { getProjectMembers, inviteProjectMember, revokeProjectInvite, updateProjectMember, removeProjectMember, offerProjectTransfer } from '../lib/collaboration';
import { supabase } from '../lib/supabase';

const CAP = { free: 2, pro: 10, pro_plus: 10 };

export default function ProjectShare() {
  useSeo({ title: 'Share project — KingxTech', noindex: true });
  useRequireAuth();
  const { id: projectId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [plan, setPlan] = useState('free');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [transferTarget, setTransferTarget] = useState(null);

  const load = async () => {
    setError('');
    try {
      const result = await getProjectMembers(projectId);
      setData(result);
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: billing } = await supabase.from('billing_profile').select('plan').eq('user_id', authData.user.id).maybeSingle();
        setPlan(billing?.plan === 'pro_plus' ? 'pro_plus' : billing?.plan === 'pro' || billing?.plan === 'paid' ? 'pro' : 'free');
      }
    } catch (e) { setError(e.message || 'Unable to load project members.'); }
  };

  useEffect(() => { if (projectId) load(); }, [projectId]);

  const me = useMemo(() => data?.members?.find((m) => m.userId === data?.currentUserId) || null, [data]);
  const cap = CAP[plan] || 2;
  const invitedCount = Math.max(0, (data?.members?.length || 1) - 1) + (data?.pendingInvites?.length || 0);
  const capReached = invitedCount >= cap;

  const invite = async (event) => {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await inviteProjectMember(projectId, email, role);
      setEmail('');
      setNotice(`Invite created. Copy this link if email delivery is not configured: ${result.inviteUrl}`);
      await load();
    } catch (e) { setError(e.message || 'Could not create invitation.'); }
    finally { setBusy(false); }
  };

  const remove = async (userId) => {
    if (!confirm('Remove this member from the project?')) return;
    setBusy(true); setError('');
    try { await removeProjectMember(projectId, userId); await load(); }
    catch (e) { setError(e.message || 'Could not remove member.'); }
    finally { setBusy(false); }
  };

  const setMemberRole = async (userId, nextRole) => {
    setBusy(true); setError('');
    try { await updateProjectMember(projectId, userId, nextRole); await load(); }
    catch (e) { setError(e.message || 'Could not change role.'); }
    finally { setBusy(false); }
  };

  const transfer = async () => {
    if (!transferTarget) return;
    setBusy(true); setError(''); setNotice('');
    try { await offerProjectTransfer(projectId, transferTarget.userId); setNotice('Ownership transfer offered. The member must accept it.'); setTransferTarget(null); }
    catch (e) { setError(e.message || 'Could not offer ownership transfer.'); }
    finally { setBusy(false); }
  };

  return (
    <DashboardShell>
      <div className="mx-auto w-full max-w-2xl pb-10">
        <button onClick={() => navigate(`/projects/${projectId}/workspace`)} className="min-h-11 inline-flex items-center gap-2 text-sm text-kxmist hover:text-white mb-4"><ArrowLeft size={16} /> Back to project</button>
        <div className="flex items-center justify-between gap-3 mb-5">
          <div><h1 className="font-display text-2xl font-semibold">Share project</h1><p className="text-sm text-kxmist mt-1">Members can work on the same project without live co-editing.</p></div>
          <Badge tone="default"><Users size={13} /> {plan === 'pro_plus' ? 'Pro+' : plan === 'pro' ? 'Pro' : 'Free'}</Badge>
        </div>

        {error && <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2 mb-4">{error}</p>}
        {notice && <p className="text-sm text-kxblue bg-kxblue/10 border border-kxblue/20 rounded-lg px-3 py-2 mb-4 break-words">{notice}</p>}

        <Card className="p-5 rounded-[20px] mb-4">
          <div className="flex items-center justify-between gap-3 mb-3"><div><h2 className="font-medium">Members</h2><p className="text-xs text-kxmist mt-1">{invitedCount} of {cap} invited members used</p></div><Shield size={18} className="text-kxpurple" /></div>
          <div className="space-y-2">
            {(data?.members || []).map((member) => (
              <div key={member.userId} className="min-h-14 flex items-center justify-between gap-3 rounded-xl border border-white/10 px-3 py-2">
                <div className="min-w-0"><p className="text-sm truncate">{member.displayName}</p><p className="text-[11px] text-kxmist truncate">{member.maskedEmail}</p></div>
                <div className="flex items-center gap-2 shrink-0">
                  <select aria-label={`Role for ${member.displayName}`} disabled={member.role === 'owner' || busy} value={member.role} onChange={(e) => setMemberRole(member.userId, e.target.value)} className="min-h-11 rounded-lg border border-white/12 bg-white/[0.02] px-2 text-xs">
                    <option value="owner">Owner</option><option value="editor">Editor</option><option value="viewer">Viewer</option>
                  </select>
                  {member.role !== 'owner' && <button aria-label={`Remove ${member.displayName}`} onClick={() => remove(member.userId)} className="min-h-11 min-w-11 inline-flex items-center justify-center text-kxmist hover:text-red-400"><UserMinus size={16} /></button>}
                  {member.role !== 'owner' && <button onClick={() => setTransferTarget(member)} className="min-h-11 px-2 text-xs text-kxpurple hover:text-white">Transfer</button>}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 rounded-[20px] mb-4">
          <div className="flex items-center gap-2 mb-3"><Mail size={17} /><h2 className="font-medium">Invite member</h2></div>
          <form onSubmit={invite} className="grid sm:grid-cols-[1fr_auto] gap-3">
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@example.com" disabled={capReached || busy} />
            <label className="block"><span className="block text-[13px] font-medium text-white/85 mb-1.5">Role</span><select value={role} onChange={(e) => setRole(e.target.value)} disabled={capReached || busy} className="w-full min-h-11 rounded-lg border border-white/12 bg-white/[0.02] px-3 text-sm"><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label>
            <Button type="submit" loading={busy} disabled={capReached || !email.trim()} className="min-h-11 sm:col-span-2"><Mail size={15} /> Invite</Button>
          </form>
          <p className="text-xs text-kxmist mt-3">{capReached ? `Member limit reached. Upgrade to Pro for more.` : `${invitedCount} of ${cap} invited members used.`}</p>
        </Card>

        {(data?.pendingInvites?.length || 0) > 0 && <Card className="p-5 rounded-[20px] mb-4"><h2 className="font-medium mb-3">Pending invites</h2><div className="space-y-2">{data.pendingInvites.map((invite) => <div key={invite.id} className="min-h-12 flex items-center justify-between gap-3 border-b border-white/8 last:border-0"><span className="text-sm">{invite.email} · {invite.role}</span><button onClick={() => revokeProjectInvite(projectId, invite.id).then(load)} className="min-h-11 px-2 text-xs text-red-400">Revoke</button></div>)}</div></Card>}

        {transferTarget && <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-3" onClick={() => setTransferTarget(null)}><Card className="w-full max-w-md p-5 rounded-[22px]" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between mb-3"><h2 className="font-display text-lg">Transfer ownership?</h2><button aria-label="Close" onClick={() => setTransferTarget(null)} className="min-h-11 min-w-11 inline-flex items-center justify-center text-kxmist"><X size={18} /></button></div><p className="text-sm text-kxmist leading-relaxed">{transferTarget.displayName} will become the owner after accepting. You will become an editor. Compute and storage remain billed to the project owner.</p><div className="flex gap-2 mt-5"><Button variant="subtle" onClick={() => setTransferTarget(null)} className="flex-1 min-h-11">Cancel</Button><Button onClick={transfer} loading={busy} className="flex-1 min-h-11"><Crown size={15} /> Offer transfer</Button></div></Card></div>}
      </div>
    </DashboardShell>
  );
}
