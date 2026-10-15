import app = require('../src/server');
import collaborationRouter from '../src/routes/projectCollaboration';
import billingRouter from '../src/services/billingRoutes';

// server.ts exports the fully configured Express app. Mount the collaboration
// router and billing router after existing routes; these paths are distinct and
// there is no terminal catch-all 404 in server.ts, so existing behavior remains
// unchanged.
app.use(collaborationRouter);
app.use(billingRouter);

export = app;
