import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ProjectWorkspace from '../pages/ProjectWorkspace';
import ProjectShareSheet from './ProjectShareSheet';
import { acceptTransfer, declineTransfer, getPendingTransfers } from '../lib/projectCollaboration';

export default function ProjectCollaborationOverlay() {
  const { id } = useParams();
  const [shareOpen, setShareOpen] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    getPendingTransfers().then((body) => { if (alive) setTransfers(body.transfers || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const refreshTransfers = () => getPendingTransfers().then((body) => setTransfers(body.transfers || [])).catch(() => {});

  return <div className="relative min-h-[100dvh]">
    <ProjectWorkspace />
    <div className="fixed right-4 bottom-[calc(80px+env(safe-area-inset-bottom))] z-40 md:right-6">
      <button type="button" onClick={() => setShareOpen(true)} className="min-h-11 min-w-11 rounded-full bg-white text-black px-4 shadow-xl font-medium" aria-label="Share project">Share</button>
    </div>
    {transfers.map((transfer) => <div key={transfer.id} className="fixed left-3 right-3 top-[calc(12px+env(safe-area-inset-top))] z-50 rounded-2xl border border-white/10 bg-kxbg p-4 shadow-2xl md:left-auto md:right-6 md:max-w-md">
      <div className="text-sm font-semibold text-white">Ownership transfer pending</div>
      <div className="text-xs text-kxmist mt-1">You have been offered ownership of {transfer.projects?.name || 'a KingxTech project'}. Accepting makes you the owner; the current owner becomes an editor.</div>
      <div className="flex gap-2 mt-3"><button className="min-h-11 flex-1 rounded-xl bg-white text-black" onClick={async () => { await acceptTransfer(transfer.id); await refreshTransfers(); window.location.reload(); }}>Accept</button><button className="min-h-11 flex-1 rounded-xl border border-white/10 text-white" onClick={async () => { await declineTransfer(transfer.id); await refreshTransfers(); }}>Decline</button></div>
    </div>)}
    <ProjectShareSheet projectId={id} open={shareOpen} onClose={() => setShareOpen(false)} />
  </div>;
}
