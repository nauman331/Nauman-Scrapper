import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { htmlToJsx } from '../src/generator/codegen/jsx-transformer.js';
import { repairGeneratedTsx } from '../src/generator/codegen/repair-generated-tsx.js';
import { generateNextConfig } from '../src/generator/codegen/project-template.js';

describe('Captured Next.js runtime and CSS custom properties', () => {
  it('emits typed CSS variables and removes copied Next runtime elements', () => {
    const result = htmlToJsx('<div style="--columns: 3; display: grid">Content<next-route-announcer>Announcement</next-route-announcer><nextjs-portal></nextjs-portal></div>');
    expect(result.jsx).toContain("'--columns': '3'");
    expect(result.jsx).toContain("as import('react').CSSProperties & Record<`--${string}`, string | number>");
    expect(result.jsx).not.toContain('next-route-announcer');
    expect(result.jsx).not.toContain('nextjs-portal');
    const file = ts.createSourceFile('page.tsx', `export default function Page(){return (${result.jsx})}`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect((file as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics).toEqual([]);
  });
  it('repairs existing generated pages without touching text or ordinary styles', () => {
    const source = "export default function Page(){return <div style={{'--columns':'2'}}><p>next-route-announcer text</p><next-route-announcer></next-route-announcer><span style={{color:'red'}}>Keep</span></div>}";
    const result = repairGeneratedTsx(source, 'page.tsx');
    expect(result).toContain('CSSProperties & Record');
    expect(result).toContain('next-route-announcer text');
    expect(result).not.toContain('<next-route-announcer>');
    expect(result).toContain("style={{color:'red'}}");
    expect(repairGeneratedTsx(result, 'page.tsx')).toBe(result);
  });
  it('repairs HTML-encoded quotes in old Tailwind class attributes', () => {
    const source = 'export default function Page(){return <div className="!cursor-[url(&quot;/cloned-assets/images/grab.cur&quot;)_16_16,auto]"/>}';
    const repaired = repairGeneratedTsx(source, 'page.tsx');
    expect(repaired).not.toContain('&quot;');
    expect(repaired).toContain('className={');
    expect(repairGeneratedTsx(repaired, 'page.tsx')).toBe(repaired);
  });
  it('preserves ymaps markup and declares its precise React intrinsic type', () => {
    const source = "'use client';\nexport default function Page(){return <ymaps className=\"map\"><ymaps data-label=\"Map\">Location</ymaps></ymaps>}";
    const result = repairGeneratedTsx(source, 'page.tsx');
    expect(result.startsWith("'use client';")).toBe(true);
    expect(result).toContain('<ymaps');
    expect(result).toContain('ymaps: CapturedYmapsProps');
    expect(result).not.toContain('[element: string]');
    expect(repairGeneratedTsx(result, 'page.tsx')).toBe(result);
  });
  it('sets generated workspace roots explicitly', () => {
    const config = generateNextConfig('example.com');
    expect(config).toContain('turbopack: { root: projectRoot }');
    expect(config).toContain('outputFileTracingRoot: projectRoot');
  });
});
