# Project collaboration staging test plan

This PR does not apply the migration to the live Supabase project.

## 1. Blank disposable Supabase project

1. Create a fresh local Supabase database (`supabase start`) or a disposable staging Supabase project.
2. Ensure the repository migrations are the reviewed branch contents.
3. Apply the migrations in numeric order, including the reserved plan-expiry slot when that PR is present. For this collaboration PR the reviewed migration is `032_project_collaboration.sql`.
4. For a local database, the normal migration path is:

```sh
supabase db reset
```

This recreates the database and applies the migration directory in order. Do not run this against production.

5. If the staging environment requires explicit SQL execution, run `supabase/migrations/001_*.sql` through `032_project_collaboration.sql` in numeric order, or use the Supabase migration runner so dependencies are preserved.

## 2. Run the collaboration RLS fixture

After the migration is applied to the disposable database, run:

```sh
supabase test db
```

The pgTAP fixture is `supabase/tests/project_collaboration_rls.test.sql`.

The fixture verifies:

- a non-member cannot read another user's project;
- authenticated users cannot directly insert membership rows, including a second owner row;
- viewers can read project files but cannot write;
- editors can write files but cannot read secret env values or delete the project;
- removing a member removes access immediately;
- ownership transfer changes the canonical owner and file/version attribution;
- transfer blanks environment values.

## 3. Manual two-account staging checks

Use two real staging accounts, A and B:

1. A creates a project.
2. Before invitation, B requests the project through the application and must receive no project data.
3. A invites B as viewer. B accepts the single-use invite while signed in with the invited email.
4. B can read the project and project chat, but all editor controls and Build-mode AI are unavailable.
5. Promote B to editor. B can edit files and versions but still cannot read environment-variable values, manage GitHub, manage domains, or delete the project.
6. Remove B. Refresh B's session and confirm access disappears immediately.
7. Re-invite B as editor. A offers ownership transfer. B sees the pending banner and accepts.
8. Confirm `projects.user_id`, `project_members.role`, `project_files.user_id`, and `project_file_versions.user_id` point to B; the old owner is an editor; env values are blank; the GitHub link is removed; domains and files remain.
9. Re-link GitHub and restore environment values as the new owner.

Never use production credentials or the live Supabase project for this test plan.
