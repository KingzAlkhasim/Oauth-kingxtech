import app = require('../src/server');
import collaborationRouter from '../src/routes/projectCollaboration';
import billingRouter from '../src/services/billingRoutes';
import projectServerRouter from '../src/services/projectServerRoutes';

// server.ts exports the fully configured Express app. Mount the collaboration
// router and billing router after existing routes; these paths are distinct and
// there is no terminal catch-all 404 in server.ts, so existing behavior remains
// unchanged.
// Order matters: the collaboration router runs requireAuth on every request that reaches it, so it must come LAST.
// Cron callers (expire-plans, project-servers-reap) send `Authorization: Bearer <CRON_SECRET>`; if that router saw them first
// it would treat the secret as a user token and answer 401 "Invalid or expired session." Billing and project-server
// routes check their own auth per route, so they are safe to mount before it.
app.use(billingRouter);
app.use(projectServerRouter);
app.use(collaborationRouter);

export = app;
