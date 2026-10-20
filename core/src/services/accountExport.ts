import { zipSync, strToU8, type Zippable } from 'fflate';
import { safeName, projectFilesToZippable } from './accountExportPure';
import { supabaseAdmin } from '../lib/supabaseAdmin';

const BUCKET = 'account-exports';
const LINK_SECONDS = 60 * 60;

/**
 * Builds one big zip: README, account.json, and projects/<name>.zip for every project the
 * user owns (each project's code is its own zip inside the big one). Uploads it to a private
 * bucket and returns a short-lived download link.
 */
export async function createAccountExport(userId: string, email?: string): Promise<{ url: string; projectCount: number; bytes: number }> {
  const { data: projects, error } = await supabaseAdmin
    .from('projects')
    .select('id, name, description, slug, product, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`export project lookup failed: ${error.message}`);

  const outer: Zippable = {};
  const used = new Set<string>();
  const manifest: unknown[] = [];

  for (const project of projects ?? []) {
    const { data: files, error: filesError } = await supabaseAdmin
      .from('project_files')
      .select('path, content')
      .eq('project_id', project.id)
      .eq('is_folder', false)
      .order('path', { ascending: true });
    if (filesError) throw new Error(`export file lookup failed: ${filesError.message}`);

    let name = safeName(project.slug || project.name, 'project');
    if (used.has(name)) name = `${name}-${String(project.id).slice(0, 6)}`;
    used.add(name);

    const inner = zipSync(projectFilesToZippable(files ?? []), { level: 6 });
    // Inner zips are already compressed, so store them as-is in the big zip.
    outer[`projects/${name}.zip`] = [inner, { level: 0 }];
    manifest.push({ name: project.name, zip: `projects/${name}.zip`, description: project.description, product: project.product, status: project.status, created_at: project.created_at, files: (files ?? []).length });
  }

  outer['account.json'] = strToU8(JSON.stringify({ exported_at: new Date().toISOString(), email: email ?? null, projects: manifest }, null, 2));
  outer['README.txt'] = strToU8(
    'KingxTech data export\n\n' +
    'projects/  - one zip per project you own. Each zip holds that project\'s files.\n' +
    'account.json - a list of your projects and when this export was made.\n\n' +
    'Environment variables and secrets are NOT included for your safety.\n',
  );

  const bytes = zipSync(outer);
  const path = `${userId}/kingxtech-export-${Date.now()}.zip`;

  // Keep only the latest export per user.
  const { data: old } = await supabaseAdmin.storage.from(BUCKET).list(userId);
  if (old?.length) await supabaseAdmin.storage.from(BUCKET).remove(old.map((o) => `${userId}/${o.name}`)).catch(() => undefined);

  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, Buffer.from(bytes), {
    contentType: 'application/zip',
    upsert: false,
  });
  if (uploadError) throw new Error(`export upload failed: ${uploadError.message}`);

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, LINK_SECONDS, { download: 'kingxtech-export.zip' });
  if (signError || !signed?.signedUrl) throw new Error(`export link failed: ${signError?.message ?? 'no url'}`);

  return { url: signed.signedUrl, projectCount: projects?.length ?? 0, bytes: bytes.length };
}
