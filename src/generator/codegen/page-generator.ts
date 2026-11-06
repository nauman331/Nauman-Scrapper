import path from 'node:path';
import { repairGeneratedTsx } from './repair-generated-tsx.js';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { canonicalDomHash, htmlToJsx, type GeneratedSvgAsset } from './jsx-transformer.js';
import { generateSectionComponent, type ComponentGeneratorResult } from './component-generator.js';
import type { PageInventoryItem } from '../types.js';

export interface PageGeneratorInput {
  item: PageInventoryItem;
  rawContentHtml: string;
  /** Prefer the intact analyzer body over legacy mainContentHtml. */
  bodyContentHtml?: string;
  sections?: Array<{ name: string; html: string }>;
  componentExtraction?: 'minimal' | 'standard' | 'deep';
  isRoot: boolean;
  bodyContext?: { id?: string; className?: string };
  sourceRoot?: 'src';
  pageNamespace?: string;
  svgRegistry?: Map<string, GeneratedSvgAsset>;
}

export interface PageGeneratorResult {
  filePath: string;
  code: string;
  /** Includes assets from every generated child, deduplicated by hash. */
  svgAssets: GeneratedSvgAsset[];
  usesLottie: boolean;
  generatedComponents?: ComponentGeneratorResult[];
}

function relativeImport(source: string, target: string): string {
  const relative = path.posix.relative(path.posix.dirname(source), target).replace(/\.tsx$/, '');
  return relative.startsWith('.') ? relative : `./${relative}`;
}

/** Route digest prevents collisions between routes with the same sanitized slug. */
function featureKey(route: string): string {
  const slug = route.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 48) || 'home';
  return `${slug}-${crypto.createHash('sha256').update(route).digest('hex').slice(0, 16)}`;
}

export function generatePageRoute(input: PageGeneratorInput): PageGeneratorResult {
  const { item, sections = [], isRoot, bodyContext } = input;
  const appRoot = input.sourceRoot ? `${input.sourceRoot}/app` : 'app';
  const filePath = isRoot ? `${appRoot}/page.tsx` : `${appRoot}${item.route}/page.tsx`;
  const pageNamespace = input.pageNamespace ?? 'page-1';
  if (!/^page-[1-9]\d*$/.test(pageNamespace)) throw new Error('Invalid generated page namespace');
  const svgRegistry = input.svgRegistry ?? (input.sourceRoot ? new Map<string, GeneratedSvgAsset>() : undefined);
  const jsxOptions = { sourceRoot: input.sourceRoot, svgRegistry };
  const usedNames = new Set<string>();
  const sourceHtml = input.bodyContentHtml ?? input.rawContentHtml;
  const $ = cheerio.load(sourceHtml || '', null, false);
  // Legacy callers may supply a serialized document. Never emit document tags in a page.
  $('head').remove();
  $('html, body').each((_, el) => { $(el).replaceWith($(el).contents()); });

  const componentTags = new Map<string, string>();
  const generatedComponents: ComponentGeneratorResult[] = [];
  const extraction = input.componentExtraction ?? 'standard';
  if (sections.length && extraction !== 'minimal') {
    const definitions = new Map<string, { name: string; html: string }>();
    for (const section of sections) {
      const fragment = cheerio.load(section.html, null, false);
      const nodes = fragment.root().contents().toArray();
      // A section is a complete single subtree, not arbitrary matching text/markup.
      if (nodes.length !== 1 || !('tagName' in nodes[0]) || ['html', 'head', 'body'].includes(nodes[0].tagName)) continue;
      const hash = canonicalDomHash(section.html);
      if (!definitions.has(hash)) definitions.set(hash, section);
    }
    const candidates = $('*').toArray().flatMap((node) => {
      const hash = canonicalDomHash($.html(node));
      const definition = definitions.get(hash);
      return definition ? [{ node, hash, definition }] : [];
    });
    const candidateNodes = new Set(candidates.map(({ node }) => node));
    const selected = extraction === 'deep' ? candidates : candidates.filter(({ node }) => {
      let ancestor = node.parent;
      while (ancestor) {
        if (candidateNodes.has(ancestor as typeof node)) return false;
        ancestor = ancestor.parent;
      }
      return true;
    });
    const byHash = new Map<string, ComponentGeneratorResult>();
    // Children first in deep mode: outer components import their extracted descendants.
    for (const candidate of [...selected].reverse()) {
      let generated = byHash.get(candidate.hash);
      if (!generated) {
        const words = candidate.definition.name.replace(/[^a-zA-Z0-9]+/g, ' ').trim().split(/\s+/);
        const base = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('') || 'Section';
        const readableName = /^[A-Z]/.test(base) ? base : `Section${base}`;
        let name = input.sourceRoot ? readableName : `${readableName}${candidate.hash.slice(0, 12)}`;
        let suffix = 2;
        while (usedNames.has(name)) name = `${readableName}${suffix++}`;
        usedNames.add(name);
        const childHtml = $.html(candidate.node);
        const children = generatedComponents.filter((child) => {
          const tag = [...componentTags].find(([, componentName]) => componentName === child.componentName)?.[0];
          return tag ? $(candidate.node).find(tag).length > 0 : false;
        });
        generated = generateSectionComponent(name, childHtml, false, {
          filePath: input.sourceRoot ? `src/components/cloned/${pageNamespace}/sections/${name}.tsx` : `features/${featureKey(item.route)}/components/${name}.tsx`,
          ...jsxOptions,
          componentTags,
          componentImports: children,
        });
        byHash.set(candidate.hash, generated);
        generatedComponents.push(generated);
      }
      // Use real DOM nodes; source lookalike attributes or text cannot be replaced accidentally.
      let tag = `next-extracted-${candidate.hash}`;
      while (sourceHtml.includes(tag)) tag += '-generated';
      componentTags.set(tag, generated.componentName);
      $(candidate.node).replaceWith(`<${tag}></${tag}>`);
    }
  }

  const composedHtml = $.html();
  const { jsx, usesLink, usesLottie: pageUsesLottie, svgAssets: pageSvgAssets } = htmlToJsx(composedHtml, true, { ...jsxOptions, componentTags });
  const imports: string[] = ["import type { Metadata } from 'next';"];
  if (usesLink) imports.push("import Link from 'next/link';");
  if (pageUsesLottie) imports.push("import { LottieAsset } from '@/components/ui/LottieAsset';");
  for (const asset of pageSvgAssets) imports.push(`import { ${asset.componentName} } from '${relativeImport(filePath, asset.filePath)}';`);
  for (const child of generatedComponents) {
    const tag = [...componentTags].find(([, name]) => name === child.componentName)?.[0];
    if (tag && $(tag).length) imports.push(`import { ${child.componentName} } from '${relativeImport(filePath, child.filePath)}';`);
  }

  const requestedWrapperId = bodyContext?.id?.trim();
  const contentAlreadyHasId = requestedWrapperId ? $('[id]').toArray().some((el) => $(el).attr('id') === requestedWrapperId) || generatedComponents.some((child) => child.code.includes(`id=${JSON.stringify(requestedWrapperId)}`)) : false;
  const wrapperId = contentAlreadyHasId ? undefined : requestedWrapperId;
  const sourceClasses = bodyContext?.className?.trim();
  const wrapperAttributes = `${wrapperId ? ` id=${JSON.stringify(wrapperId)}` : ''} className=${JSON.stringify(['page-container', sourceClasses].filter(Boolean).join(' '))}`;
  const code = `${imports.join('\n')}

export const metadata: Metadata = {
  title: ${JSON.stringify(item.title || 'Page')},
  description: ${JSON.stringify(item.description || '')},
};

export default function ${item.componentName}() {
  return (
    <div${wrapperAttributes}>
      ${jsx}
    </div>
  );
}
`;
  const svgAssets = [...new Map([...pageSvgAssets, ...generatedComponents.flatMap((child) => child.svgAssets)].map((asset) => [asset.hash, asset])).values()];
  return {
    filePath, code: repairGeneratedTsx(code, filePath), svgAssets,
    usesLottie: pageUsesLottie || generatedComponents.some((child) => child.usesLottie),
    ...(sections.length ? { generatedComponents } : {}),
  };
}
