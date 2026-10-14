import express, { type Response } from 'express';
import type { AuthedRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { acceptProjectInvite, acceptTransfer, cancelTransfer, changeProjectMemberRole, createProjectInvite, createTransferRequest, declineTransfer, listPendingTransfers, listProjectMembers, removeProjectMember, revokeProjectInvite } from '../services/projectCollaboration';

const router = express.Router();
router.use(requireAuth);

function sendError(res: Response, error: unknown) {
  const e = error as { status?: number; code?: string; message?: string };
  res.status(e.status && e.status >= 400 ? e.status : 500).json({ success: false, error: e.message || 'Collaboration request failed.', ...(e.code ? { code: e.code } : {}) });
}

router.get('/api/projects/:projectId/members', async (req: AuthedRequest, res) => {
  try { res.json({ success: true, ...(await listProjectMembers(req.user!.id, req.params.projectId)) }); } catch (error) { sendError(res, error); }
});

router.post('/api/projects/:projectId/invites', rateLimit, async (req: AuthedRequest, res) => {
  try { const { email, role } = req.body ?? {}; res.status(201).json({ success: true, ...(await createProjectInvite(req.user!.id, req.params.projectId, String(email || ''), role)) }); } catch (error) { sendError(res, error); }
});
router.delete('/api/projects/:projectId/invites/:inviteId', async (req: AuthedRequest, res) => {
  try { await revokeProjectInvite(req.user!.id, req.params.projectId, req.params.inviteId); res.json({ success: true }); } catch (error) { sendError(res, error); }
});

router.patch('/api/projects/:projectId/members/:userId', async (req: AuthedRequest, res) => {
  try { await changeProjectMemberRole(req.user!.id, req.params.projectId, req.params.userId, req.body?.role); res.json({ success: true }); } catch (error) { sendError(res, error); }
});
router.delete('/api/projects/:projectId/members/:userId', async (req: AuthedRequest, res) => {
  try { await removeProjectMember(req.user!.id, req.params.projectId, req.params.userId); res.json({ success: true }); } catch (error) { sendError(res, error); }
});

router.post('/api/invites/accept', async (req: AuthedRequest, res) => {
  try {
    if (req.authMethod !== 'session' || !req.user?.email) return res.status(401).json({ success: false, error: 'Sign in with the invited email to accept this invitation.', code: 'session_email_required' });
    res.json({ success: true, ...(await acceptProjectInvite(req.user.id, req.user.email, String(req.body?.token || ''))) });
  } catch (error) { sendError(res, error); }
});

router.post('/api/projects/:projectId/transfer', async (req: AuthedRequest, res) => {
  try { res.status(201).json({ success: true, ...(await createTransferRequest(req.user!.id, req.params.projectId, String(req.body?.toUserId || ''))) }); } catch (error) { sendError(res, error); }
});
router.get('/api/transfers/pending', async (req: AuthedRequest, res) => {
  try { res.json({ success: true, transfers: await listPendingTransfers(req.user!.id) }); } catch (error) { sendError(res, error); }
});
router.post('/api/transfers/:id/accept', async (req: AuthedRequest, res) => {
  try { res.json({ success: true, ...(await acceptTransfer(req.user!.id, req.params.id)) }); } catch (error) { sendError(res, error); }
});
router.post('/api/transfers/:id/decline', async (req: AuthedRequest, res) => {
  try { await declineTransfer(req.user!.id, req.params.id); res.json({ success: true }); } catch (error) { sendError(res, error); }
});
router.post('/api/transfers/:id/cancel', async (req: AuthedRequest, res) => {
  try { await cancelTransfer(req.user!.id, req.params.id); res.json({ success: true }); } catch (error) { sendError(res, error); }
});

export default router;
