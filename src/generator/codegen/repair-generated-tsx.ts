import ts from 'typescript';

/** Upgrade older generated snapshots without suppressing TypeScript build errors. */
export function repairGeneratedTsx(source: string, filename: string): string {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits: Array<{ start: number; end: number; text: string }> = [];
  let hasYmaps = false;
  function visit(node: ts.Node): void {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText(file) : node.tagName.getText(file);
      if (tag === 'ymaps') hasYmaps = true;
      if (tag === 'next-route-announcer' || tag === 'nextjs-portal') {
        edits.push({ start: node.getStart(file), end: node.end, text: '' });
        return;
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'className' && node.initializer && ts.isStringLiteral(node.initializer)) {
      const raw = node.initializer.getText(file).slice(1, -1);
      if (/&quot;|&#34;|&#x22;|&apos;|&#39;|&#x27;/i.test(raw)) {
        const decoded = raw.replace(/&quot;|&#34;|&#x22;/gi, '\"').replace(/&apos;|&#39;|&#x27;/gi, "'").replace(/&amp;/gi, '&');
        edits.push({ start: node.initializer.getStart(file), end: node.initializer.end, text: `{${JSON.stringify(decoded)}}` });
      }
    }
    if (ts.isJsxAttribute(node) && node.name.getText(file) === 'style' && node.initializer && ts.isJsxExpression(node.initializer)) {
      const expression = node.initializer.expression;
      if (expression && ts.isObjectLiteralExpression(expression) && expression.properties.some((property) =>
        ts.isPropertyAssignment(property) && ts.isStringLiteral(property.name) && property.name.text.startsWith('--'))) {
        edits.push({ start: expression.end, end: expression.end, text: " as import('react').CSSProperties & Record<`--${string}`, string | number>" });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  if (hasYmaps && !source.includes('interface CapturedYmapsProps')) {
    // Preserve Yandex's nonstandard element and its CSS selectors. React 19
    // requires an explicit intrinsic type; do not erase the captured map tree.
    source += `\n\ninterface CapturedYmapsProps extends CapturedYmapsHTMLAttributes<HTMLElement> {\n  [attribute: string]: unknown;\n}\n\ndeclare module 'react' {\n  namespace JSX {\n    interface IntrinsicElements {\n      ymaps: CapturedYmapsProps;\n    }\n  }\n}\n`;
    source += "\nimport type { HTMLAttributes as CapturedYmapsHTMLAttributes } from 'react';\n";
  }
  return source;
}
