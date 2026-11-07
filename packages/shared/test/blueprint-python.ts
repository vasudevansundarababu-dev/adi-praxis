import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** True when a local python3 is available to check generated Python (syntax and literals only; nothing is run). */
export const hasPython = spawnSync('python3', ['--version']).status === 0;

const INSPECT = `
import ast, json, sys
tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())
funcs = [n.name for n in tree.body if isinstance(n, ast.FunctionDef)]
consts = {}
for n in tree.body:
    if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name):
        name = n.targets[0].id
        try:
            consts[name] = ast.literal_eval(n.value)
        except ValueError:
            if name == "MILESTONE_BODIES":
                consts[name] = eval(compile(ast.Expression(n.value), "<bodies>", "eval"), {"__builtins__": {}})
imports = sorted({a.name for n in ast.walk(tree) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names})
print(json.dumps({"funcs": funcs, "consts": consts, "imports": imports}))
`;

export interface PythonShape {
  funcs: string[];
  consts: Record<string, unknown>;
  imports: string[];
}

/** Parses Python source with `ast` (never executes it) and returns its top-level functions and literal constants. */
export function inspectPython(source: string): PythonShape {
  const dir = mkdtempSync(path.join(tmpdir(), 'praxis-py-'));
  const file = path.join(dir, 'module.py');
  writeFileSync(file, source, 'utf8');
  return JSON.parse(execFileSync('python3', ['-c', INSPECT, file], { encoding: 'utf8' })) as PythonShape;
}
