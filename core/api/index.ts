import app = require('../src/server');
import { registerProjectCollaborationRoutes } from '../src/services/projectCollaborationRoutes';

// Collaboration routes are mounted after the shared Express app is constructed.
// Authorization is re-checked inside each handler/service; the client never supplies a role.
registerProjectCollaborationRoutes(app);

export = app;
