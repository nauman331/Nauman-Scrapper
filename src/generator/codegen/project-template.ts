export interface ProjectTemplateOptions {
  projectName: string;
  domain: string;
  targetUrl: string;
  routes: Array<{ path: string; label: string }>;
  pageCount: number;
  cssStrategy: 'original' | 'tailwind';
  usesLottie?: boolean;
}

export function generatePackageJson(options: ProjectTemplateOptions): string {
  const pkg = {
    name: options.projectName.toLowerCase(),
    version: '0.1.0',
    private: true,
    scripts: {
      dev: 'next dev',
      build: 'next build',
      start: 'next start',
      lint: 'tsc --noEmit',
      typecheck: 'tsc --noEmit',
      check: 'npm run typecheck && npm run build',
    },
    dependencies: {
      next: '^16.4.3',
      react: '^19.3.1',
      'react-dom': '^19.3.1',
      'lucide-react': '^0.453.0',
      clsx: '^2.1.1',
      'tailwind-merge': '^2.5.4',
      ...(options.usesLottie ? { 'lottie-react': '^2.4.1' } : {}),
    },
    devDependencies: {
      postcss: '8.5.31',
      autoprefixer: '10.4.21',
      'postcss-nesting': '13.0.2',
      ...(options.cssStrategy === 'tailwind' ? { tailwindcss: '3.4.17' } : {}),
      '@types/node': '^20.14.0',
      '@types/react': '^19.3.0',
      '@types/react-dom': '^19.3.0',
      typescript: '^5.9.3',
    },
  };

  return JSON.stringify(pkg, null, 2);
}

export function generateLottieAssetComponent(): string {
  return `'use client';

import Lottie from 'lottie-react';
import { useEffect, useState } from 'react';

export interface LottieAssetProps {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
  direction?: 1 | -1;
  'aria-label'?: string;
  'aria-hidden'?: string | boolean;
}

export function LottieAsset({ src, className, loop = true, autoplay = true, direction = 1, ...aria }: LottieAssetProps) {
  const [animationData, setAnimationData] = useState<unknown>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setAnimationData(null);
    setFailed(false);
    fetch(src, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Animation request failed');
        return response.json() as Promise<unknown>;
      })
      .then(setAnimationData)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
      });
    return () => controller.abort();
  }, [src]);

  if (failed) return null;
  return (
    <div className={className} {...aria}>
      {animationData ? <Lottie animationData={animationData} loop={loop} autoplay={autoplay} direction={direction} /> : null}
    </div>
  );
}
`;
}

export function generateTsConfig(sourceRoot?: 'src'): string {
  const tsconfig = {
    compilerOptions: {
      target: 'es5',
      lib: ['dom', 'dom.iterable', 'esnext'],
      allowJs: true,
      skipLibCheck: true,
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: 'esnext',
      moduleResolution: 'bundler',
      resolveJsonModule: true,
      isolatedModules: true,
      jsx: 'preserve',
      incremental: true,
      plugins: [
        {
          name: 'next',
        },
      ],
      paths: {
        '@/*': [sourceRoot ? './src/*' : './*'],
      },
    },
    include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
    exclude: ['node_modules'],
  };

  return JSON.stringify(tsconfig, null, 2);
}

export function generateNextConfig(domain: string): string {
  return `import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: { root: projectRoot },
  outputFileTracingRoot: projectRoot,
  reactStrictMode: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '${domain}',
      },
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;
`;
}


export function generateTailwindConfig(sourceRoot?: 'src'): string {
  return `/** @type {import('tailwindcss').Config} */
const config = {
  content: [
${(sourceRoot ? ['src/app', 'src/components', 'src/lib'] : ['app', 'components', 'features', 'assets']).map((directory) => `    './${directory}/**/*.{js,ts,jsx,tsx,mdx}',`).join('\n')}
  ],
  theme: { extend: {} },
  plugins: [],
};

export default config;
`;
}

export function generatePostCssConfig(strategy: 'original' | 'tailwind' = 'tailwind'): string {
  return `export default {
  plugins: {
    'postcss-nesting': {},
${strategy === 'tailwind' ? '    tailwindcss: {},\n' : ''}    autoprefixer: {},
  },
};
`;
}

export function generateSiteConfig(options: ProjectTemplateOptions): string {
  return `export interface NavItem {
  title: string;
  href: string;
}

export const siteConfig = {
  name: ${JSON.stringify(options.projectName)},
  description: 'Generated Next.js project converted from scraped website ${options.domain}',
  originalUrl: ${JSON.stringify(options.targetUrl)},
  navItems: ${JSON.stringify(
    options.routes.map((r) => ({ title: r.label, href: r.path })),
    null,
    2
  )} as NavItem[],
};
`;
}

export function generateUtils(): string {
  return `import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;
}

export function generateReadme(options: ProjectTemplateOptions): string {
  return `# ${options.projectName}

This is a generated **Next.js 16 App Router** static snapshot adapted from **${options.targetUrl}**. Static validation does not replace a production build or browser verification. Run \`npm run check\` before deployment.

Styling mode: **${options.cssStrategy === 'tailwind' ? 'Tailwind CSS with residual fallback CSS' : 'Preserved original CSS'}**.

---

## 🚀 Getting Started

Follow these steps to run the application locally:

### 1. Install Dependencies
\`\`\`bash
npm install
\`\`\`

### 2. Run the Development Server
\`\`\`bash
npm run dev
\`\`\`

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

### 3. Build for Production
\`\`\`bash
npm run build
npm start
\`\`\`

---

## 📁 Project Architecture

\`\`\`
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Document shell; route-specific chrome stays in place
│   │   ├── globals.css         # Original CSS or Tailwind 3 with residual fallback CSS
│   │   ├── page.tsx            # Homepage route
${options.routes
  .filter((r) => r.path !== '/')
  .map((r) => `│   │   └── ${r.path.replace(/^\//, '')}/page.tsx # Route: ${r.path}`)
  .join('\n')}
│   ├── components/
│   │   ├── cloned/page-1/sections/ # Page-owned sections; page-2, etc. for other pages
│   │   ├── icons/generated/    # Deduplicated inline SVG React components
│   │   └── ui/                 # Runtime helpers, only when referenced
│   └── lib/
│       ├── site-config.ts      # Navigation and site metadata
│       └── utils.ts            # Utility functions
└── public/cloned-assets/
    ├── images/                 # Downloaded images and graphics
    ├── fonts/                  # Downloaded web fonts
    ├── icons/                  # Favicons and image-based icons
    ├── animations/             # Lottie JSON, only when downloaded
    └── css/                    # Downloaded and localized source stylesheets
\`\`\`

---

## 🛠 Features Preserved
- **Next.js App Router**: Clean page routes with React Server Components by default.
- **Visual Design Fidelity**: ${options.cssStrategy === 'tailwind' ? 'Safe declarations are emitted as Tailwind utilities; complex rules remain in globals.css.' : 'Typography, layout grids, spacing, colors, and styling are preserved.'}
- **Local Assets**: All images, icons, and stylesheets resolved locally inside \`public/\`.
- **Internal Navigation**: Internal URLs transformed into Next.js \`<Link>\` components.
- **Interaction limits**: Copied scripts and inline handlers are removed. Source forms, menus, and other backend-dependent behavior require implementation and browser verification.

---

*Generated by Web Scraper Platform.*
`;
}
