import { useState } from 'react';
import { Card } from './ui';
import ProjectShareSheet from './ProjectShareSheet';

export default function ShareSettingsCard({ projectId }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="p-4 rounded-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold">Share &amp; collaborate</h3>
            <p className="text-[11.5px] text-kxmist mt-0.5 leading-relaxed">
              Invite people to view or edit this project. Invitations are sent by email, and you can copy the link if needed.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Share project"
            className="shrink-0 min-h-11 min-w-11 px-4 rounded-xl bg-white text-black text-[13px] font-medium"
          >
            Share
          </button>
        </div>
      </Card>
      <ProjectShareSheet projectId={projectId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
