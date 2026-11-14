import { supabase } from './supabase';
import { apiUrl } from './apiBase';

// Address people paste into Claude or ChatGPT.
export const connectorUrl = () => new URL(apiUrl('/mcp'), window.location.origin).href;

// What a connected AI app can and cannot do. Shown on the approval page and in Account > Connected apps.
export const CONNECTOR_CAN = [
  'See your project list and each project’s publish and server status',
  'Read the text files in your projects (secrets files like .env are hidden)',
  'Create or replace text files in projects you can edit',
  'See your plan and how much storage you have used',
];
export const CONNECTOR_CANNOT = [
  'Delete files or projects',
  'Publish sites or start servers',
  'See or change environment variables and secrets',
  'Touch billing, domains or account settings',
];

export const getAuthorizationDetails = (id) => supabase.auth.oauth.getAuthorizationDetails(id);
export const approveAuthorization = (id) => supabase.auth.oauth.approveAuthorization(id);
export const denyAuthorization = (id) => supabase.auth.oauth.denyAuthorization(id);
export const listConnectedApps = () => supabase.auth.oauth.getUserGrants();
export const revokeConnectedApp = (clientId) => supabase.auth.oauth.revokeGrant(clientId);
