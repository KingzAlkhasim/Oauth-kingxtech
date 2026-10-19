import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import ProjectWorkspace from '../pages/ProjectWorkspace';
import { acceptTransfer, declineTransfer, getPendingTransfers, getProjectMembers } from '../lib/projectCollaboration';
import { supabase } from '../lib/supabase';

export default function ProjectCollaborationOverlay() {
  const { id } = useParams();
  const [transfers, setTransfers] = useState([]);
  const [viewOnly, setViewOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([
      getPendingTransfers(),
      supabase.auth.getUser(),
    ]).then(async ([transferBody, userBody]) => {
      if (!alive) return;
      setTransfers(transferBody.transfers || []);
      if (!id || !userBody.data.user?.id) return;
      try {
        const members = await getProjectMembers(id);
        const current = members.members?.find((member) => member.userId === userBody.data.user.id);
        setViewOnly(current?.role === 'viewer');
      } catch {
        setViewOnly(false);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [id]);

  const refreshTransfers = () => getPendingTransfers().then((body) => setTransfers(body.transfers || [])).catch(() => {});

  return (
    <div className={`relative min-h-[100dvh] ${viewOnly ? 'kx-view-only-project' : ''}`}>
      <ProjectWorkspace />
      {viewOnly && (
        <div className="fixed left-3 right-3 top-[calc(12px+env(safe-area-inset-top))] z-40 rounded-2xl border border-white/10 bg-kxbg/95 px-4 py-3 shadow-xl backdrop-blur md:left-6 md:right-auto md:max-w-md">
          <div className="text-sm font-semibold text-white">View only</div>
          <div className="text-xs text-kxmist mt-1">You can read this shared project and ask K-XpertAI questions in Plan mode. Editing, publishing and project management are disabled.</div>
        </div>
      )}
      <style>{viewOnly ? `
        .kx-view-only-project .cm-editor { pointer-events: none; opacity: .72; }
        .kx-view-only-project button[title*="Delete"],
        .kx-view-only-project button[title*="Save"],
        .kx-view-only-project button[title*="New file"],
        .kx-view-only-project button[title*="New folder"],
        .kx-view-only-project button[title*="Publish"],
        .kx-view-only-project button[title*="Terminal"],
        .kx-view-only-project button[title*="GitHub"],
        .kx-view-only-project button[title*="Security"] { display: none !important; }
      ` : ''}</style>
      {transfers.map((transfer) => (
        <div key={transfer.id} className="fixed left-3 right-3 top-[calc(12px+env(safe-area-inset-top))] z-50 rounded-2xl border border-white/10 bg-kxbg p-4 shadow-2xl md:left-auto md:right-6 md:max-w-md">
          <div className="text-sm font-semibold text-white">Ownership transfer pending</div>
          <div className="text-xs text-kxmist mt-1">You have been offered ownership of {transfer.projects?.name || 'a KingxTech project'}. Accepting makes you the owner; the current owner becomes an editor.</div>
          <div className="flex gap-2 mt-3">
            <button className="min-h-11 flex-1 rounded-xl bg-white text-black" onClick={async () => { await acceptTransfer(transfer.id); await refreshTransfers(); window.location.reload(); }}>Accept</button>
            <button className="min-h-11 flex-1 rounded-xl border border-white/10 text-white" onClick={async () => { await declineTransfer(transfer.id); await refreshTransfers(); }}>Decline</button>
          </div>
        </div>
      ))}
    </div>
  );
}
