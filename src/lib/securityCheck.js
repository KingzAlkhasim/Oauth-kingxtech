import { supabase } from './supabase';

const API_BASE = 'https://kx-neurocore-1066169621814.us-central1.run.app';

async function authHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be signed in.');
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
}

// Throws with `.requiresPro` or `.requiresCredits` set on the error object so
// the UI can distinguish "you're not Pro" from "you're out of credits" from
// any other real failure, and show the right message/CTA for each.
export async function runSecurityCheck(projectId) {
  const headers = await authHeaders();
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/security-check`, {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!data.success) {
    const err = new Error(data.error || 'SecureCheck failed to run');
    err.requiresPro = !!data.requiresPro;
    err.requiresCredits = !!data.requiresCredits;
    throw err;
  }
  return data; // { claude, gemini, filesReviewed, generatedAt, creditsRemaining }
}