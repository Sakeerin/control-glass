import { spawnSync } from "node:child_process";
import { z } from "zod";

const ImportSchema = z.array(z.object({ specifier: z.string(), line: z.number() }));
const TokenSchema = z.array(z.object({ kind: z.string(), text: z.string() }));
export type NativeImport = z.infer<typeof ImportSchema>[number];
export interface PhpToken { readonly kind: string; readonly text: string; readonly start: number; readonly end: number; }
const parsedResults = new Map<string, string>();

function parseNative(executable: string, args: readonly string[], source: string): string {
  const cacheKey = executable + "\0" + args.join("\0") + "\0" + (process.env["PATH"] ?? "") + "\0" + source;
  const cached = parsedResults.get(cacheKey);
  if (cached !== undefined) return cached;
  const options = { input: source, encoding: "utf8" as const, timeout: 10_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true };
  let result = spawnSync(executable, [...args], options);
  if (executable === "php" && result.status === 42) result = spawnSync(executable, ["-n", "-d", "extension=tokenizer", ...args.slice(1)], options);
  if (result.error || result.status !== 0) throw new Error("NATIVE_SOURCE_PARSER_FAILED: " + executable);
  if (source.length <= 200_000) {
    if (parsedResults.size >= 32) parsedResults.clear();
    parsedResults.set(cacheKey, result.stdout);
  }
  return result.stdout;
}

export function parsePythonImports(source: string): NativeImport[] {
  const script = 'import ast,json,sys\ntree=ast.parse(sys.stdin.read())\nimports=[]\nfor node in ast.walk(tree):\n if isinstance(node,ast.Import):\n  imports.extend({"specifier":item.name,"line":node.lineno} for item in node.names)\n elif isinstance(node,ast.ImportFrom):\n  imports.append({"specifier":"."*node.level+(node.module or ""),"line":node.lineno})\nprint(json.dumps(imports))';
  return ImportSchema.parse(JSON.parse(parseNative("python", ["-I", "-S", "-c", script], source)));
}

export function parsePhpTokens(source: string): PhpToken[] {
  const prefix = /<\?(?:php\b|=)/i.test(source) ? "" : "<?php\n";
  const script = 'if(!function_exists("token_get_all")){exit(42);}$source=stream_get_contents(STDIN);$result=[];foreach(token_get_all($source,TOKEN_PARSE) as $token){$result[]=["kind"=>is_array($token)?token_name($token[0]):$token,"text"=>is_array($token)?$token[1]:$token];}echo json_encode($result,JSON_THROW_ON_ERROR);';
  const tokens = TokenSchema.parse(JSON.parse(parseNative("php", ["-n", "-r", script], prefix + source)));
  let cursor = -prefix.length;
  const result: PhpToken[] = [];
  for (const token of tokens) {
    const start = cursor;
    cursor += token.text.length;
    if (cursor > 0) result.push({ ...token, start: Math.max(start, 0), end: cursor });
  }
  return result;
}
