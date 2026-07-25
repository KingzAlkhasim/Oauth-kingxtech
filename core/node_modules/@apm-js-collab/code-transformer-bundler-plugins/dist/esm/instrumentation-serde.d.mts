import { InstrumentationConfig } from '@apm-js-collab/code-transformer';
/**
 * A plain-object encoding of a `RegExp` that survives JSON serialization.
 * Revive it with `new RegExp(source, flags)`.
 */
export interface SerializedRegExp {
    type: 'RegExp';
    source: string;
    flags: string;
}
/**
 * An `InstrumentationConfig` whose `module.filePath` is never a `RegExp`
 * instance — regexes are encoded as {@link SerializedRegExp} — making the
 * whole config a POJO that can cross serialization boundaries such as
 * Turbopack's loader options.
 */
export type SerializableInstrumentationConfig = InstrumentationConfig extends infer T ? T extends {
    module: InstrumentationConfig['module'];
} ? Omit<T, 'module'> & {
    module: Omit<T['module'], 'filePath'> & {
        filePath: string | SerializedRegExp;
    };
} : never : never;
/** Either the native config shape or its JSON-safe counterpart. */
export type AnyInstrumentationConfig = InstrumentationConfig | SerializableInstrumentationConfig;
/**
 * Converts any `RegExp` `module.filePath` into a plain `{ source, flags }`
 * object so the configs can be passed where only JSON-serializable values are
 * allowed (e.g. Turbopack loader options). Configs that are already
 * serializable are returned unchanged.
 */
export declare function serializeInstrumentations(configs: AnyInstrumentationConfig[]): SerializableInstrumentationConfig[];
/**
 * Revives serialized `{ source, flags }` file paths back into `RegExp`
 * instances. Accepts a mix of serialized and native configs so callers can
 * pass user-supplied options straight through.
 */
export declare function deserializeInstrumentations(configs: AnyInstrumentationConfig[]): InstrumentationConfig[];
//# sourceMappingURL=instrumentation-serde.d.mts.map