import { ENV } from '../../config/env.js';

export function renderDocsHtml(): string {
  const defaultApiKey = ENV.API_KEY || 'dev-scrape-secret-key-2026';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation | Production Web Scraping Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #121826;
      --sidebar-bg: #0d121f;
      --border: #1f293d;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --accent-glow: rgba(59, 130, 246, 0.25);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --green: #10b981;
      --purple: #8b5cf6;
      --code-bg: #070a12;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
    }
    /* Sidebar */
    .sidebar {
      width: 260px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .brand {
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      text-decoration: none;
      color: #fff;
    }
    .brand-icon {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
      box-shadow: 0 4px 12px var(--accent-glow);
    }
    .brand-text { font-size: 16px; font-weight: 700; letter-spacing: -0.3px; }
    .brand-tag { font-size: 10px; background: rgba(59,130,246,0.2); color: #93c5fd; padding: 2px 6px; border-radius: 4px; margin-left: 4px; }
    .nav { padding: 16px 12px; display: flex; flex-direction: column; gap: 4px; flex: 1; }
    .nav-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; padding: 8px 12px; letter-spacing: 0.5px; }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .nav-link:hover { color: #fff; background: rgba(255,255,255,0.05); }
    .nav-link.active { color: #fff; background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.3); }
    .nav-icon { font-size: 16px; }

    /* Main Container */
    .main-wrap { flex: 1; display: flex; flex-direction: column; overflow-y: auto; max-height: 100vh; }
    .topbar {
      height: 64px;
      background: var(--sidebar-bg);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .page-title { font-size: 18px; font-weight: 700; }
    .top-actions { display: flex; align-items: center; gap: 12px; }
    .btn-secondary {
      background: rgba(255,255,255,0.06);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      transition: all 0.2s;
    }
    .btn-secondary:hover { background: rgba(255,255,255,0.1); border-color: #475569; }

    /* Content Area */
    .content { padding: 36px; max-width: 1000px; margin: 0 auto; width: 100%; }
    .hero { margin-bottom: 32px; }
    .hero h1 { font-size: 28px; font-weight: 800; margin-bottom: 8px; }
    .hero p { color: var(--text-muted); font-size: 15px; line-height: 1.6; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px; margin-bottom: 32px; }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
    }
    .metric-title { font-size: 12px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.5px; }
    .metric-val { font-size: 20px; font-weight: 700; margin-top: 6px; color: #fff; }
    .section-title { font-size: 20px; font-weight: 700; margin: 32px 0 16px; border-bottom: 1px solid var(--border); padding-bottom: 10px; }
    
    .endpoint-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .endpoint-header {
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
    }
    .endpoint-path { display: flex; align-items: center; gap: 12px; font-family: 'JetBrains Mono', monospace; font-size: 14px; }
    .badge { padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 700; }
    .badge-get { background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); }
    .badge-post { background: rgba(16,185,129,0.15); color: #34d399; border: 1px solid rgba(16,185,129,0.3); }
    .endpoint-body { padding: 20px; }
    .endpoint-desc { color: var(--text-muted); font-size: 14px; margin-bottom: 14px; }
    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      color: #e2e8f0;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <!-- Sidebar -->
  <aside class="sidebar">
    <a href="/" class="brand">
      <div class="brand-icon">⚡</div>
      <div class="brand-text">Scraper Platform <span class="brand-tag">v1.0</span></div>
    </a>
    <div class="nav">
      <div class="nav-label">Navigation</div>
      <a href="/" class="nav-link">
        <span class="nav-icon">🎮</span> Playground
      </a>
      <a href="/docs" class="nav-link active">
        <span class="nav-icon">📖</span> Documentation
      </a>
      <div class="nav-label">Monitoring</div>
      <a href="/health" target="_blank" class="nav-link">
        <span class="nav-icon">💚</span> /health (Liveness)
      </a>
      <a href="/ready" target="_blank" class="nav-link">
        <span class="nav-icon">🟢</span> /ready (Readiness)
      </a>
    </div>
  </aside>

  <!-- Main Content -->
  <div class="main-wrap">
    <header class="topbar">
      <div class="page-title">API Documentation & Architecture</div>
      <div class="top-actions">
        <a href="/" class="btn-secondary">🎮 Open Playground</a>
      </div>
    </header>

    <div class="content">
      <div class="hero">
        <h1>Production Web Scraping API</h1>
        <p>
          High-performance distributed web crawling engine powered by Crawlee, Playwright (Chromium), Cheerio, and Prisma ORM. Idempotent results, anti-SSRF protection, and per-domain pacing built-in.
        </p>
      </div>

      <div class="grid">
        <div class="metric-card">
          <div class="metric-title">Active Database</div>
          <div class="metric-val">${ENV.DATABASE_URL.includes('scrape.db') ? 'SQLite (scrape.db)' : 'Live DB'}</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Queue Engine</div>
          <div class="metric-val">${ENV.QUEUE_ADAPTER.toUpperCase()} (Priority Queue)</div>
        </div>
        <div class="metric-card">
          <div class="metric-title">Default Concurrency</div>
          <div class="metric-val">${ENV.DEFAULT_CONCURRENCY} Workers</div>
        </div>
      </div>

      <h2 class="section-title">REST API Endpoints</h2>

      <!-- POST /api/v1/jobs -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <div class="endpoint-path">
            <span class="badge badge-post">POST</span>
            <span>/api/v1/jobs</span>
          </div>
          <span style="font-size: 13px; color: var(--text-muted);">Enqueue Scraping Job</span>
        </div>
        <div class="endpoint-body">
          <div class="endpoint-desc">Accepts a target URL, strategy (AUTO, CHEERIO, PLAYWRIGHT), limits, and extraction configuration.</div>
          <pre>curl -X POST http://localhost:3200/api/v1/jobs \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${defaultApiKey}" \\
  -d '{
    "targetUrl": "https://example.com",
    "strategy": "AUTO",
    "maxDepth": 1,
    "maxPages": 5,
    "extractionConfig": {
      "extractMetadata": true,
      "extractHeadings": true,
      "extractMainText": true,
      "customSelectors": [
        { "name": "heading", "selector": "h1", "transform": "trim" }
      ]
    }
  }'</pre>
        </div>
      </div>

      <!-- GET /api/v1/jobs -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <div class="endpoint-path">
            <span class="badge badge-get">GET</span>
            <span>/api/v1/jobs</span>
          </div>
          <span style="font-size: 13px; color: var(--text-muted);">List Jobs</span>
        </div>
        <div class="endpoint-body">
          <div class="endpoint-desc">Returns paginated jobs with status, counters, and attempt metrics. Query params: <code>status</code>, <code>domain</code>, <code>limit</code>, <code>offset</code>.</div>
          <pre>curl -X GET "http://localhost:3200/api/v1/jobs?limit=10" \\
  -H "x-api-key: ${defaultApiKey}"</pre>
        </div>
      </div>

      <!-- GET /api/v1/jobs/:id/results -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <div class="endpoint-path">
            <span class="badge badge-get">GET</span>
            <span>/api/v1/jobs/:id/results</span>
          </div>
          <span style="font-size: 13px; color: var(--text-muted);">Get Extracted Data</span>
        </div>
        <div class="endpoint-body">
          <div class="endpoint-desc">Retrieves normalized, validated data records extracted during crawl execution. Idempotently indexed by <code>[jobId, urlHash]</code>.</div>
          <pre>curl -X GET "http://localhost:3200/api/v1/jobs/JOB_ID_HERE/results" \\
  -H "x-api-key: ${defaultApiKey}"</pre>
        </div>
      </div>

      <!-- GET /api/v1/jobs/:id/clean-data -->
      <div class="endpoint-card">
        <div class="endpoint-header"><div class="endpoint-path"><span class="badge badge-get">GET</span><span>/api/v1/jobs/:id/clean-data</span></div><span style="font-size: 13px; color: var(--text-muted);">Get Clean Data</span></div>
        <div class="endpoint-body"><div class="endpoint-desc">Aggregates all crawled pages into one stable JSON record with landing-page metadata, contacts, profiles, and one prioritized logo.</div><pre>curl -X GET "http://localhost:3200/api/v1/jobs/JOB_ID_HERE/clean-data" \
  -H "x-api-key: ${defaultApiKey}"</pre></div>
      </div>

      <!-- GET /health & /ready -->
      <div class="endpoint-card">
        <div class="endpoint-header">
          <div class="endpoint-path">
            <span class="badge badge-get">GET</span>
            <span>/health & /ready</span>
          </div>
          <span style="font-size: 13px; color: var(--text-muted);">Health Probes</span>
        </div>
        <div class="endpoint-body">
          <div class="endpoint-desc">Liveness probe and readiness probe validating database connectivity and queue health. Always public for container orchestrators.</div>
          <pre>curl http://localhost:3200/health
curl http://localhost:3200/ready</pre>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;
}
