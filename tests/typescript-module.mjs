import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

export async function loadTypeScriptModule(url) {
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  const sandbox = { module: { exports }, exports };
  vm.runInNewContext(output, sandbox, { filename: url.pathname });
  return sandbox.module.exports;
}
