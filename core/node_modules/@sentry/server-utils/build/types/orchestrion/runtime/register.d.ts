export interface RegisterDiagnosticsChannelInjectionOptions {
    /**
     * Absolute directory of the `@apm-js-collab/tracing-hooks` package (forward slashes).
     *
     * Needed when SDK code is bundled into an app's server build: the default bare-specifier
     * require then resolves from the emitted chunk, which fails under isolated installs (pnpm).
     * Framework SDKs (e.g. `@sentry/nextjs`) resolve the package at build time and pass its
     * location here; it is loaded through an opaque `createRequire` that bundlers can't trace.
     */
    tracingHooksDir?: string;
}
/**
 * Synchronously register the diagnostics-channel injection module hooks.
 *
 * This is the single source of truth for the registration logic. It is used by:
 * - `Sentry.init()` (the Node SDK calls it directly — that's why this module
 *   must be CJS-compatible / dual-built, so it can be `require()`d synchronously
 *   before the app's `import`s resolve), and
 * - `import-hook.mjs`, the side-effecting `--import` entry, which just calls it.
 *
 * Libraries imported *after* this call publish the `tracingChannel` events that
 * the channel-based integrations subscribe to.
 */
export declare function registerDiagnosticsChannelInjection(options?: RegisterDiagnosticsChannelInjectionOptions): void;
//# sourceMappingURL=register.d.ts.map