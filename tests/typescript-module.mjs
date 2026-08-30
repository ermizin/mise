import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

export async function loadTypeScriptModule(url) {
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  }).outputText;
  const exports = {};
  const sandbox = { module: { exports }, exports, require: createRequire(url) };
  vm.runInNewContext(output, sandbox, { filename: url.pathname });
  return sandbox.module.exports;
}
