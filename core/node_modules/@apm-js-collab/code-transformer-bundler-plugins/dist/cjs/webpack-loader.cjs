const require_chunk = require("./chunk-D6vf50IK.cjs");
const require_instrumentation_serde = require("./instrumentation-serde-BFky_HG6.cjs");
let _apm_js_collab_code_transformer = require("@apm-js-collab/code-transformer");
let path = require("path");
let fs = require("fs");
let module_details_from_path = require("module-details-from-path");
module_details_from_path = require_chunk.__toESM(module_details_from_path, 1);
//#region src/webpack-loader.ts
var moduleDetailsFromPath = module_details_from_path.default || module_details_from_path;
/**
* Helper function to get module version from package.json
*/
function getModuleVersion(basedir) {
	try {
		const packageJsonPath = (0, path.join)(basedir, "package.json");
		const packageJson = JSON.parse((0, fs.readFileSync)(packageJsonPath, "utf8"));
		if (packageJson.version) return packageJson.version;
	} catch (error) {}
}
var matcherCache = /* @__PURE__ */ new Map();
var DIAGNOSTICS_STATE_KEY = "__codeTransformerWebpackDiagnostics";
function getDiagnosticsState(loaderContext) {
	return loaderContext?._compilation?.[DIAGNOSTICS_STATE_KEY];
}
/**
* Get or create a matcher instance with caching based on config hash
*/
function getMatcher(instrumentations, dcModule) {
	const configHash = JSON.stringify({
		instrumentations: require_instrumentation_serde.serializeInstrumentations(instrumentations),
		dcModule
	});
	if (matcherCache.has(configHash)) return matcherCache.get(configHash);
	for (const [hash, matcher] of matcherCache.entries()) if (hash !== configHash) matcherCache.delete(hash);
	const matcher = (0, _apm_js_collab_code_transformer.create)(require_instrumentation_serde.deserializeInstrumentations(instrumentations), dcModule ?? null);
	matcherCache.set(configHash, matcher);
	return matcher;
}
/**
* Webpack loader that instruments JavaScript code using code-transformer
*
* This is a webpack loader (not a plugin) for compatibility with tools that only support loaders,
* such as Next.js Turbopack. Unlike the other exports in this package, this does not use unplugin.
*/
function codeTransformerLoader(code, inputSourceMap) {
	const callback = this.async();
	const options = this.getOptions();
	const resourcePath = this.resourcePath;
	const ext = (0, path.extname)(resourcePath);
	let moduleType = ext === ".mjs" || ext === ".ts" || ext === ".tsx" ? "esm" : "unknown";
	if (ext === ".js") moduleType = code.includes("export ") || code.includes("import ") ? "esm" : "cjs";
	else if (ext === ".cjs") moduleType = "cjs";
	const moduleDetails = moduleDetailsFromPath(resourcePath);
	if (!moduleDetails) return callback(null, code, inputSourceMap);
	const moduleName = moduleDetails.name;
	const moduleVersion = getModuleVersion(moduleDetails.basedir);
	if (!moduleVersion) return callback(null, code, inputSourceMap);
	const transformer = getMatcher(options.instrumentations, options.dcModule).getTransformer(moduleName, moduleVersion, moduleDetails.path);
	if (!transformer) return callback(null, code, inputSourceMap);
	try {
		const result = transformer.transform(code, moduleType, inputSourceMap);
		getDiagnosticsState(this)?.transformedModules.add(transformer.moduleName);
		callback(null, result.code, result.map);
	} catch (error) {
		console.warn(`[code-transformer-loader] Error transforming ${resourcePath}:`, error);
		getDiagnosticsState(this)?.failedModules.add(moduleDetails.name);
		callback(null, code, inputSourceMap);
	}
}
//#endregion
module.exports = codeTransformerLoader;

//# sourceMappingURL=webpack-loader.cjs.map