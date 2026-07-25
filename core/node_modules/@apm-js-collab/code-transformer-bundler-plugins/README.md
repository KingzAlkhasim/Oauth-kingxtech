# @apm-js-collab/code-transformer-bundler-plugins

A universal plugin that uses
[`@apm-js-collab/code-transformer`](https://github.com/apm-js-collab/orchestrion-js)
to instrument JavaScript code at build time for application performance
monitoring and tracing.

**Compatible with Rollup, Webpack, Vite, esbuild, Bun, and more!**

## Installation

```bash
npm install @apm-js-collab/code-transformer-bundler-plugins
# or
yarn add @apm-js-collab/code-transformer-bundler-plugins
# or
pnpm add @apm-js-collab/code-transformer-bundler-plugins
```

## Usage

### Rollup

```javascript
// rollup.config.js
import codeTransformer from "@apm-js-collab/code-transformer-bundler-plugins/rollup";

export default {
  input: "src/index.js",
  output: {
    file: "dist/bundle.js",
    format: "esm",
  },
  plugins: [
    codeTransformer({
      instrumentations: [
        {
          channelName: "fetch:request",
          module: {
            name: "undici",
            versionRange: ">=5.0.0",
            filePath: "index.js",
          },
          functionQuery: {
            className: "Undici",
            methodName: "fetch",
            kind: "Async",
          },
        },
      ],
    }),
  ],
};
```

### Webpack

```javascript
// webpack.config.js
const codeTransformer = require(
  "@apm-js-collab/code-transformer-bundler-plugins/webpack",
);

module.exports = {
  entry: "./src/index.js",
  plugins: [
    codeTransformer({
      instrumentations: [
        // ... your instrumentations
      ],
    }),
  ],
};
```

### Vite

```javascript
// vite.config.js
import { defineConfig } from "vite";
import codeTransformer from "@apm-js-collab/code-transformer-bundler-plugins/vite";

export default defineConfig({
  plugins: [
    codeTransformer({
      instrumentations: [
        // ... your instrumentations
      ],
    }),
  ],
});
```

### esbuild

```javascript
// build.js
import { build } from "esbuild";
import codeTransformer from "@apm-js-collab/code-transformer-bundler-plugins/esbuild";

build({
  entryPoints: ["src/index.js"],
  bundle: true,
  plugins: [
    codeTransformer({
      instrumentations: [
        // ... your instrumentations
      ],
    }),
  ],
});
```

### Bun Build

```javascript
// build.ts
import codeTransformer from "@apm-js-collab/code-transformer-bundler-plugins/bun";

await Bun.build({
  entrypoints: ["src/index.ts"],
  plugins: [
    codeTransformer({
      instrumentations: [
        // ... your instrumentations
      ],
    }),
  ],
});
```

### Bun Run

```javascript
// plugin.ts
import codeTransformer from "@apm-js-collab/code-transformer-bundler-plugins/bun";
import { plugin } from "bun";

plugin(codeTransformer({
  instrumentations: [
    // ... your instrumentations
  ],
}));
```

```bash
$ bun run --import=./plugin.ts app.ts
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `instrumentations` | `InstrumentationConfig[]` | The instrumentations to apply. See [orchestrion-js](https://github.com/nodejs/orchestrion-js) for the config shape. |
| `dcModule` | `string?` | Path to a polyfill module for `diagnostics_channel`. |
| `injectDiagnostics` | `(diagnostics) => string?` | Called after the build with `{ transformedModules, failedModules }`; the returned code is prepended to every entry point bundle. The code is injected after bundling, so it must not contain `import`/`require`. |
| `transformFilter` | `TransformIdFilter \| false` | Restricts which module ids the transform hook runs on (default `/node_modules/`). Supported by bundlers with hook filters (Rollup ≥ 4.38, Rolldown, Vite). |
| `customTransforms` | `Record<string, CustomTransform>` | Custom transforms registered on the matcher via orchestrion's `addTransform`. See below. |

## Custom transforms: injecting code into instrumented files

An `InstrumentationConfig` can name a custom transform in its `transform`
field. The function is called for every AST node matched by that config's
`functionQuery`/`astQuery` as `(state, node, parent, ancestry)`, where `state`
is the matched config spread together with
`{ dcModule, moduleType, moduleVersion }`.

This can be used to inject code — including `import`/`require` statements —
into the files being instrumented. Because the injection happens during the
transform, the bundler resolves and bundles whatever the injected code
imports, and the code is only included when the instrumented package is
actually part of the build. A single transform can serve every injection site
by branching on `state.module.name`:

```javascript
import { parse } from "meriyah";
import codeTransformer from "@apm-js-collab/code-transformer-bundler-plugins/vite";

const INTEGRATIONS = {
  mysql: `import { subscribeToMysql } from 'my-tracing-library';
subscribeToMysql();`,
};

// One transform handles every injection site; `state` identifies the site.
function injectIntegration(state, program) {
  const { module: { name }, moduleType } = state;
  const snippet = INTEGRATIONS[name];
  if (!snippet) return;

  // A file can be matched by several configs; only inject once.
  if (program.__integrationInjected) return;
  program.__integrationInjected = true;

  const statements = parse(snippet, { module: moduleType === "esm" }).body;
  // Insert after any "use strict" directive, like orchestrion's built-ins.
  const index = program.body.findIndex((node) => node.directive === "use strict");
  program.body.splice(index + 1, 0, ...statements);
}

const mysqlMatcher = {
  name: "mysql",
  versionRange: ">=2.0.0",
  filePath: "lib/connection.js",
};

codeTransformer({
  instrumentations: [
    // The real instrumentation
    {
      channelName: "mysql:query",
      module: mysqlMatcher,
      functionQuery: { methodName: "query", kind: "Callback" },
    },
    // The injection site: same module matcher, Program node, custom transform
    {
      channelName: "integration-injection",
      module: mysqlMatcher,
      astQuery: "Program",
      transform: "injectIntegration",
    },
  ],
  customTransforms: { injectIntegration },
});
```

Things to be aware of:

- A `Program` config matches whenever the *file* matches the module matcher,
  so the injection also happens if a sibling function query found nothing in
  that file. To gate on "a function was actually wrapped", order the injection
  config last and check the program for orchestrion's channel setup:
  `program.body.some((n) => n.declarations?.[0]?.id?.properties?.[0]?.value?.name === "tr_ch_apm_tracingChannel")`.
- Because the always-matching `Program` config counts as an injection point,
  orchestrion's "Failed to find injection points" error is suppressed for that
  file, so such modules will not appear in `injectDiagnostics`'s
  `failedModules`.
- Custom transforms mutate ESTree nodes. Parse code snippets with
  [`meriyah`](https://github.com/meriyah/meriyah) (orchestrion's own parser)
  so the resulting AST round-trips through code generation.
