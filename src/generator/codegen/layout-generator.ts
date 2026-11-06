export interface LayoutGeneratorOptions {
  siteTitle: string;
  siteDescription?: string | null;
  hasHeader: boolean;
  hasFooter: boolean;
  hasNavigation: boolean;
  bodyClassName?: string;
  htmlLang?: string;
  htmlDir?: 'ltr' | 'rtl' | 'auto';
  /** Page fragments already own their source chrome and layout. */
  preserveSourceLayout?: boolean;
}

export function generateRootLayout(options: LayoutGeneratorOptions): string {
  const imports: string[] = ["import type { Metadata } from 'next';", "import './globals.css';"];

  if (!options.preserveSourceLayout && options.hasHeader) imports.push("import { Header } from '@/components/layout/Header';");
  if (!options.preserveSourceLayout && options.hasFooter) imports.push("import { Footer } from '@/components/layout/Footer';");
  if (!options.preserveSourceLayout && options.hasNavigation && !options.hasHeader) imports.push("import { Navigation } from '@/components/layout/Navigation';");

  const titleStr = JSON.stringify(options.siteTitle || 'Website');
  const descStr = JSON.stringify(options.siteDescription || 'Converted Next.js project');
  const htmlLang = JSON.stringify(options.htmlLang || 'en');
  const htmlDir = options.htmlDir ? ` dir=${JSON.stringify(options.htmlDir)}` : '';
  const bodyClassName = (options.preserveSourceLayout ? [options.bodyClassName] : ['min-h-screen', 'flex', 'flex-col', 'antialiased', options.bodyClassName])
    .filter(Boolean)
    .join(' ');
  const topComponent = options.preserveSourceLayout ? '' : options.hasHeader
    ? '        <Header />'
    : options.hasNavigation
      ? '        <Navigation />'
      : '';
  const bottomComponent = !options.preserveSourceLayout && options.hasFooter ? '        <Footer />' : '';

  return `${imports.join('\n')}

export const metadata: Metadata = {
  title: ${titleStr},
  description: ${descStr},
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang=${htmlLang}${htmlDir}>
      <body className=${JSON.stringify(bodyClassName)}>
${topComponent ? `${topComponent}\n` : ''}        ${options.preserveSourceLayout ? '{children}' : '<main className="flex-1">{children}</main>'}
${bottomComponent ? `${bottomComponent}\n` : ''}      </body>
    </html>
  );
}
`;
}
