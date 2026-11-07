import type ts from "typescript";
import { loadTypeScript } from "./source-analysis.js";

export interface ModuleReference { readonly specifier: string | null; readonly position: number; }

export function collectModuleReferences(sourceFile: ts.SourceFile): ModuleReference[] {
  const ts = loadTypeScript();
  const references: ModuleReference[] = [];
  let checker: ts.TypeChecker | undefined;
  function symbolAt(node: ts.Identifier): ts.Symbol | undefined {
    if (checker === undefined) {
      const host: ts.CompilerHost = {
        getSourceFile: file => file === sourceFile.fileName ? sourceFile : undefined,
        getDefaultLibFileName: () => "", writeFile: () => undefined, getCurrentDirectory: () => "",
        getDirectories: () => [], fileExists: file => file === sourceFile.fileName,
        readFile: file => file === sourceFile.fileName ? sourceFile.text : undefined,
        getCanonicalFileName: file => file, useCaseSensitiveFileNames: () => true, getNewLine: () => "\n"
      };
      checker = ts.createProgram([sourceFile.fileName], { noLib: true, noResolve: true }, host).getTypeChecker();
    }
    return checker.getSymbolAtLocation(node);
  }
  function unwrap(node: ts.Expression): ts.Expression {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) node = node.expression;
    return node;
  }
  function constant(node: ts.Identifier): ts.Expression | undefined {
    const declaration = symbolAt(node)?.valueDeclaration;
    return declaration && ts.isVariableDeclaration(declaration) && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0 ? declaration.initializer : undefined;
  }
  function stringValue(expression: ts.Expression, seen = new Set<ts.Node>()): string | null {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size >= 32) return null;
    const visited = new Set(seen).add(node);
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isIdentifier(node)) {
      const value = constant(node);
      return value ? stringValue(value, visited) : null;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = stringValue(node.left, visited);
      const right = stringValue(node.right, visited);
      return left === null || right === null ? null : left + right;
    }
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        const value = stringValue(span.expression, visited);
        if (value === null) return null;
        result += value + span.literal.text;
      }
      return result;
    }
    return null;
  }
  function nativeLoader(expression: ts.Expression, seen = new Set<ts.Node>()): boolean {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size >= 32) return false;
    const visited = new Set(seen).add(node);
    if (ts.isIdentifier(node)) {
      if (node.text === "require" && symbolAt(node) === undefined) return true;
      const value = constant(node);
      return value !== undefined && nativeLoader(value, visited);
    }
    return ts.isPropertyAccessExpression(node) && node.name.text === "require" && ts.isIdentifier(node.expression) && node.expression.text === "module" && symbolAt(node.expression) === undefined;
  }
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) references.push({ specifier: node.moduleSpecifier.text, position: node.getStart(sourceFile) });
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression) references.push({ specifier: stringValue(node.moduleReference.expression), position: node.getStart(sourceFile) });
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || nativeLoader(node.expression))) references.push({ specifier: node.arguments[0] ? stringValue(node.arguments[0]) : null, position: node.getStart(sourceFile) });
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

export function containsUncheckedType(type: ts.TypeNode): boolean {
  const ts = loadTypeScript();
  function visit(node: ts.Node): boolean {
    return node.kind === ts.SyntaxKind.UnknownKeyword || node.kind === ts.SyntaxKind.AnyKeyword || ts.forEachChild(node, child => visit(child) ? true : undefined) === true;
  }
  return visit(type);
}
