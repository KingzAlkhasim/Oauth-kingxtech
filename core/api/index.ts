import app = require('../src/server');
import collaborationRouter from '../src/routes/projectCollaboration';

// server.ts exports the fully configured Express app. Mount the collaboration
// router after existing routes; collaboration paths are distinct and there is
// no terminal catch-all 404 in server.ts, so unmatched collaboration paths are
// handled by this router without changing existing route behavior.
app.use(collaborationRouter);

export = app;
