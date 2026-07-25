import { Compiler } from 'webpack';
import { CodeTransformerPluginOptions } from './core';
declare class CodeTransformerWebpackPlugin {
    private readonly options;
    constructor(options: CodeTransformerPluginOptions);
    apply(compiler: Compiler): void;
}
export default function codeTransformerWebpack(options: CodeTransformerPluginOptions): CodeTransformerWebpackPlugin;
export type { CodeTransformerPluginOptions } from './core';
//# sourceMappingURL=webpack.d.mts.map