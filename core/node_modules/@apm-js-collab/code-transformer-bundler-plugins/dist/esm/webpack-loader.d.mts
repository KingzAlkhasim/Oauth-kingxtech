import { AnyInstrumentationConfig } from './instrumentation-serde';
/**
 * Webpack loader that instruments JavaScript code using code-transformer
 *
 * This is a webpack loader (not a plugin) for compatibility with tools that only support loaders,
 * such as Next.js Turbopack. Unlike the other exports in this package, this does not use unplugin.
 */
declare function codeTransformerLoader(this: any, code: string, inputSourceMap?: any): any;
declare namespace codeTransformerLoader {
    /**
     * Options for the code transformer webpack loader.
     *
     * Turbopack requires loader options to be JSON-serializable, so any
     * `RegExp` in `module.filePath` must be passed in its serialized
     * `{ source, flags }` form there — see `serializeInstrumentations` in the
     * `/core` export.
     */
    interface Options {
        /** Array of instrumentation configurations */
        instrumentations: AnyInstrumentationConfig[];
        /** Optional path to a polyfill module for diagnostics_channel */
        dcModule?: string;
    }
}
export default codeTransformerLoader;
//# sourceMappingURL=webpack-loader.d.mts.map