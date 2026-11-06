import path from 'node:path';
import { repairGeneratedTsx } from './repair-generated-tsx.js';
import { htmlToJsx, type GeneratedSvgAsset, type HtmlToJsxOptions } from './jsx-transformer.js';
import type { SharedComponentDefinition, DetectedInteraction } from '../types.js';

export interface ComponentGeneratorResult {
  componentName: string;
  filePath: string;
  code: string;
  isClientComponent: boolean;
  usesLottie: boolean;
  svgAssets: GeneratedSvgAsset[];
}

function svgAssetImports(sourceFilePath: string, assets: GeneratedSvgAsset[]): string[] {
  return assets.map((asset) => {
    let relativePath = path.posix.relative(path.posix.dirname(sourceFilePath), asset.filePath);
    relativePath = relativePath.replace(/\.tsx$/, '');
    if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
    return `import { ${asset.componentName} } from '${relativePath}';`;
  });
}

export function generateSharedComponent(
  component: SharedComponentDefinition,
  rawHtml: string
): ComponentGeneratorResult {
  const { jsx, usesLink, usesLottie, svgAssets } = htmlToJsx(rawHtml);
  const isClient = component.isClientComponent;

  const imports: string[] = ["import React from 'react';"];
  if (usesLink) {
    imports.push("import Link from 'next/link';");
  }
  if (usesLottie) imports.push("import { LottieAsset } from '@/components/ui/LottieAsset';");
  imports.push(...svgAssetImports(component.filePath, svgAssets));

  const clientDirective = isClient ? "'use client';\n\n" : '';

  const code = `${clientDirective}${imports.join('\n')}

export function ${component.name}() {
  return (
    ${jsx}
  );
}

export default ${component.name};
`;

  return {
    componentName: component.name,
    filePath: component.filePath,
    code: repairGeneratedTsx(code, component.filePath),
    isClientComponent: isClient,
    usesLottie,
    svgAssets,
  };
}

export interface SectionGeneratorOptions extends HtmlToJsxOptions {
  filePath?: string;
  componentImports?: Array<{ componentName: string; filePath: string }>;
}

export function generateSectionComponent(
  name: string,
  rawHtml: string,
  isClientComponent = false,
  options: SectionGeneratorOptions = {},
): ComponentGeneratorResult {
  const filePath = options.filePath || `components/sections/${name}.tsx`;
  const { jsx, usesLink, usesLottie, svgAssets } = htmlToJsx(rawHtml, true, options);

  const imports: string[] = ["import React from 'react';"];
  if (usesLink) {
    imports.push("import Link from 'next/link';");
  }
  if (usesLottie) imports.push("import { LottieAsset } from '@/components/ui/LottieAsset';");
  imports.push(...svgAssetImports(filePath, svgAssets));
  for (const child of options.componentImports || []) {
    let relativePath = path.posix.relative(path.posix.dirname(filePath), child.filePath).replace(/\.tsx$/, '');
    if (!relativePath.startsWith('.')) relativePath = `./${relativePath}`;
    imports.push(`import { ${child.componentName} } from '${relativePath}';`);
  }

  const clientDirective = isClientComponent ? "'use client';\n\n" : '';

  const code = `${clientDirective}${imports.join('\n')}

export function ${name}() {
  return (
    ${jsx}
  );
}

export default ${name};
`;

  return {
    componentName: name,
    filePath,
    code: repairGeneratedTsx(code, filePath),
    isClientComponent,
    usesLottie,
    svgAssets,
  };
}

export function generateInteractiveWidget(interaction: DetectedInteraction): ComponentGeneratorResult | null {
  if (interaction.type === 'accordion') {
    const code = `'use client';

import React, { useState } from 'react';

export interface AccordionItemProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function AccordionItem({ title, children, defaultOpen = false }: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 py-3">
      <button
        type="button"
        className="w-full flex justify-between items-center text-left font-medium text-gray-900 dark:text-white"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span>{title}</span>
        <span className="ml-2 transform transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}>
          ▼
        </span>
      </button>
      {isOpen && <div className="mt-2 text-gray-600 dark:text-gray-300 text-sm">{children}</div>}
    </div>
  );
}
`;
    return {
      componentName: 'Accordion',
      filePath: 'components/ui/Accordion.tsx',
      code,
      isClientComponent: true,
      usesLottie: false,
      svgAssets: [],
    };
  }

  if (interaction.type === 'mobile-nav') {
    const code = `'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export interface MobileNavProps {
  items: Array<{ title: string; href: string }>;
}

export function MobileNav({ items }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="p-2 rounded-md text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle navigation"
        aria-expanded={isOpen}
      >
        <span className="text-xl">{isOpen ? '✕' : '☰'}</span>
      </button>

      {isOpen && (
        <div className="absolute top-16 left-0 w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 p-4 shadow-lg z-50">
          <nav className="flex flex-col space-y-3">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-gray-800 dark:text-gray-200 hover:text-blue-600 dark:hover:text-blue-400 font-medium py-1"
                onClick={() => setIsOpen(false)}
              >
                {item.title}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
`;
    return {
      componentName: 'MobileNav',
      filePath: 'components/ui/MobileNav.tsx',
      code,
      isClientComponent: true,
      usesLottie: false,
      svgAssets: [],
    };
  }

  return null;
}
