export function renderHtmlGeneratorWorkspace(): string {
  return `
    <section class="nextjs-workspace view-hidden" id="htmlView" aria-labelledby="htmlTitle">
      <style>
        #htmlView .tree-node { background:transparent; border:0; text-align:left; width:100%; }
        #htmlView .tree-node:hover { background:rgba(255,255,255,0.05); }
        #htmlView .tree-node.active { background:rgba(37,99,235,0.2); }
        #htmlView .form-group, #htmlView .file-content-pane { min-width:0; }
        #htmlView .stage-icon { font-size:9px; }
        #htmlView #htmlScrapeProgressTrack { height:6px; background:rgba(255,255,255,0.06); border-radius:999px; margin:14px 0; overflow:hidden; }
        #htmlView #htmlScrapeProgressBar { height:100%; background:linear-gradient(90deg,#3b82f6,#10b981); transition:width 0.3s ease; }
        #htmlView #htmlScrapeProgressBar.scrape-indeterminate { width:35%; animation:html-scrape-pulse 1.4s ease-in-out infinite alternate; }
        @keyframes html-scrape-pulse { from { transform:translateX(0); } to { transform:translateX(185%); } }
        #htmlView #htmlScrapeProgressBar, #htmlView #htmlProgressBar { position:relative; overflow:hidden; }
        #htmlView .progress-active::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent); transform:translateX(-100%); animation:html-progress-shimmer 1.6s linear infinite; }
        @keyframes html-progress-shimmer { to { transform:translateX(100%); } }
        #htmlView #htmlConversionProgressTrack { position:relative; height:10px; background:rgba(255,255,255,0.06); border-radius:999px; margin:14px 0; overflow:hidden; }
        #htmlView #htmlConversionActivity { position:absolute; inset:0; pointer-events:none; }
        #htmlView #htmlConversionActivity::after { content:''; position:absolute; top:0; bottom:0; width:25%; background:linear-gradient(90deg,transparent,rgba(96,165,250,0.9),rgba(255,255,255,0.75),transparent); animation:html-conversion-activity 1.8s linear infinite; }
        @keyframes html-conversion-activity { from { transform:translateX(-100%); } to { transform:translateX(400%); } }
        #htmlView #htmlConversionActivity[hidden] { display:none; }
        @media (prefers-reduced-motion:reduce) {
          #htmlView #htmlScrapeProgressBar, #htmlView #htmlProgressBar { animation:none; transition:none !important; }
          #htmlView .progress-active::after { animation:none; transform:none; opacity:0.3; }
          #htmlView #htmlConversionActivity::after { animation:none; transform:none; opacity:0.3; }
        }
        #htmlView #htmlValidationDetails { max-height:220px; overflow:auto; overflow-wrap:anywhere; }
        @media (max-width:900px) {
          #htmlView .options-grid, #htmlView .explorer-grid { grid-template-columns:minmax(0,1fr); }
          #htmlView .file-tree-pane { max-height:260px; overflow:auto; border-right:0; border-bottom:1px solid var(--border); }
          #htmlView .btn-download-hero { flex-wrap:wrap; }
        }
      </style>
      <div class="nextjs-header">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <h1 class="nextjs-title" id="htmlTitle">HTML Project Generator</h1>
            <p class="nextjs-copy">Enter the page URLs you want to convert, or load a saved scrape snapshot. Each page uses the existing HTML capture and conversion pipeline with Tailwind CDN or external Core CSS, local images and fonts. No Node.js installation is needed for the download.</p>
          </div>
          <div id="htmlActiveJobBadge" class="badge-nextjs" style="display:none;"><span id="htmlJobLabel">Job Selected</span></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:20px;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-bolt"></use></svg> 1. Select URL or Scrape Snapshot &amp; Output Options</span>
          <button class="btn-reset" style="margin-top:0;padding:5px 12px;font-size:11px;" onclick="populateHtmlJobsList()">Refresh from Scraper</button>
        </div>
        <div class="form-group" style="margin-top:14px;">
          <label class="form-label" for="htmlCssStrategy">Styling Strategy</label>
          <select id="htmlCssStrategy" class="strategy-select" onchange="updateHtmlCssStrategyHint()" aria-describedby="htmlCssStrategyHint" style="margin-top:0;">
            <option value="tailwind">HTML + Tailwind CSS (CDN)</option>
            <option value="core">HTML + Core CSS</option>
          </select>
          <div id="htmlCssStrategyHint" class="field-hint">Source styling becomes Tailwind utility classes, including responsive and interactive variants. No original CSS or fallback stylesheets are retained. Unsupported effects are reported in conversion warnings.</div>
        </div>
        <form id="htmlUrlForm" onsubmit="executeHtmlScrape(event)" style="margin-top:14px;">
          <fieldset id="htmlProxyControls" style="border:1px solid var(--border);border-radius:8px;padding:14px;margin:0 0 18px;min-width:0;">
            <legend class="form-label">Connection routing</legend>
            <label class="toggle-item" for="htmlEnableProxy"><input type="checkbox" id="htmlEnableProxy" class="toggle-checkbox" onchange="handleHtmlProxyToggle()" aria-describedby="htmlProxyHint"><span class="toggle-label">Enable saved proxy</span></label>
            <div class="form-group" style="margin-top:12px;">
              <label class="form-label" for="htmlProxySelect">Saved proxy</label>
              <select id="htmlProxySelect" class="strategy-select" disabled onchange="handleHtmlProxyToggle()" aria-describedby="htmlProxyHint" style="margin-top:0;"><option value="">Select a proxy</option></select>
            </div>
            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-top:10px;">
              <button id="btnHtmlRefreshProxies" type="button" class="history-btn" onclick="refreshHtmlProxies()">Refresh proxies</button>
              <a href="/proxies" onclick="event.preventDefault();showView('proxies')">Manage / add proxies</a>
            </div>
            <p id="htmlProxyHint" class="field-hint" role="status" aria-live="polite">Proxy disabled. Scraping and conversion asset downloads use a direct connection.</p>
          </fieldset>
          <div id="htmlUrlRows">
            <div class="form-group">
              <label class="form-label" for="htmlTargetUrl">Page URL · Entry page</label>
              <input id="htmlTargetUrl" class="proxy-input html-page-url" placeholder="https://example.com" required autocomplete="url" style="margin-top:0;">
              <div class="field-hint">Enter a public URL, for example soundcloud.com. Only clone sites you have permission to reproduce.</div>
            </div>
          </div>
          <button id="btnHtmlAddPage" type="button" class="history-btn" onclick="addHtmlPageRow()" aria-label="Add another page URL">+ Add page</button>
          <div class="field-hint">Only these URLs will be scraped. Add up to 500 pages from the same website.</div>
          <div hidden>
            <div class="form-group">
              <label class="form-label" for="htmlCloneMode">Clone Scope</label>
              <select id="htmlCloneMode" class="strategy-select" onchange="handleHtmlScopeChange()" style="margin-top:0;">
                <option value="single">Single-page clone</option>
                <option value="full">Full-website clone (discovered pages)</option>
              </select>
              <div class="field-hint">Each captured page gets its own HTML file. Full-site crawling follows same-site links, not private or undiscoverable pages.</div>
            </div>
            <div class="form-group">
              <label class="form-label" for="htmlMaxPages">Maximum Pages</label>
              <input id="htmlMaxPages" class="proxy-input" type="number" min="1" max="500" value="1" disabled style="margin-top:0;">
              <div class="field-hint">Full-site limit: 500 pages, depth 10. Large websites may require multiple scrapes.</div>
            </div>
            <div class="form-group">
              <label class="form-label" for="htmlStrategy">Crawler Engine</label>
              <select id="htmlStrategy" class="strategy-select" style="margin-top:0;">
                <option value="PLAYWRIGHT">PLAYWRIGHT (Rendered HTML)</option>
                <option value="AUTO">AUTO (SPA Detection)</option>
                <option value="CHEERIO">CHEERIO (Static HTML)</option>
              </select>
              <div class="field-hint">Rendered HTML captures JavaScript-created layout. Source application scripts are not included in the static export.</div>
            </div>
          </div>
          <div style="display:flex;justify-content:flex-end;">
            <button id="btnHtmlScrape" class="btn-submit" type="submit" style="max-width:280px;height:44px;margin-top:0;">Scrape the website</button>
          </div>
        </form>
        <div id="htmlScrapeProgressCard" class="card" style="display:none;margin-top:20px;" aria-labelledby="htmlScrapeProgressTitle">
          <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
            <span id="htmlScrapeProgressTitle">Scrape Pipeline Progress</span><span id="htmlScrapeProgressPercent" class="badge-status">Starting</span>
          </div>
          <div id="htmlScrapeProgressTrack" role="progressbar" aria-label="Website scrape progress" aria-valuemin="0" aria-valuemax="100"><div id="htmlScrapeProgressBar"></div></div>
          <p id="htmlScrapeProgressStatus" class="field-hint" role="status" aria-live="polite"></p>
          <div class="stages-list" id="htmlScrapeStagesList"></div>
        </div>
        <p id="htmlMessage" class="field-hint" role="status" aria-live="polite"></p>
        <div class="options-grid" style="margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <div class="form-group">
            <label class="form-label" for="htmlJobSelect">Target Scrape Job</label>
            <select id="htmlJobSelect" class="strategy-select" onchange="loadHtmlSnapshot()"><option value="">-- Select a scraped job --</option></select>
          </div>
          <div class="form-group" style="display:flex;align-items:end;">
            <button class="btn-submit" style="height:44px;margin-top:0;" onclick="loadHtmlSnapshot()">Load Snapshot</button>
          </div>
        </div>
        <div id="htmlOptionsContainer" style="display:none;margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <div class="options-grid">
            <div class="form-group">
              <label class="form-label" for="htmlProjectName">Project Name</label>
              <input id="htmlProjectName" class="proxy-input" value="scraped-html-site" pattern="[a-zA-Z0-9_-]+" maxlength="64" required style="margin-top:0;">
              <div class="field-hint">Alphanumeric, hyphens and underscores. Download archive name.</div>
            </div>
            <div class="form-group">
              <label class="form-label">Advanced Preservation</label>
              <div class="toggle-group" style="margin-top:4px;">
                <label class="toggle-item"><input type="checkbox" id="htmlPreserveInteractivity" class="toggle-checkbox" checked><span class="toggle-label">Native HTML Controls</span></label>
                <label class="toggle-item"><input type="checkbox" id="htmlPreserveMetadata" class="toggle-checkbox" checked><span class="toggle-label">SEO Metadata</span></label>
              </div>
              <div class="field-hint">Native links and controls can work offline. Login, search, playback and other server-dependent behavior are not recreated.</div>
            </div>
          </div>
          <div style="margin-top:24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
              <label class="form-label" style="margin-bottom:0;">Pages &amp; HTML Files to Include</label>
              <div style="display:flex;gap:8px;">
                <button type="button" class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="toggleHtmlPages(true)">Select All</button>
                <button type="button" class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="toggleHtmlPages(false)">Deselect All</button>
              </div>
            </div>
            <div style="border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:260px;background:var(--card-inner);">
              <table class="pages-table" id="htmlPagesTable"><thead><tr><th style="width:48px;">No.</th><th style="width:40px;">Inc</th><th>Route</th><th>Page Title</th><th>Output</th><th>Source URL</th></tr></thead><tbody id="htmlPagesList"></tbody></table>
            </div>
          </div>
          <div style="margin-top:24px;display:flex;justify-content:flex-end;">
            <button id="btnHtmlConversion" class="btn-submit" style="max-width:280px;height:48px;font-size:14px;gap:8px;" onclick="executeHtmlConversion()"><svg class="icon" aria-hidden="true"><use href="#icon-bolt"></use></svg><span>Convert to HTML Project</span></button>
          </div>
        </div>
      </div>
      <div id="htmlProgressCard" class="card" style="display:none;margin-bottom:20px;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;"><span>2. Conversion Pipeline Stages</span><span id="htmlProgressPercent" class="badge-status">0%</span></div>
        <div id="htmlConversionProgressTrack" role="progressbar" aria-label="HTML conversion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="htmlProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #3b82f6, #10b981);transition:width 0.3s ease;"></div><div id="htmlConversionActivity" hidden></div></div>
        <p id="htmlConversionActivityStatus" class="field-hint" role="status" aria-live="polite"></p>
        <div class="stages-list" id="htmlStagesList"></div>
      </div>
      <div id="htmlResultCard" class="card" style="display:none;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <span>3. Generated Project Preview &amp; Export</span>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
            <span id="htmlValidationBadge" class="badge-status">Validation</span>
            <button id="btnHtmlDownloadZip" class="btn-download-hero" onclick="downloadHtmlZip()"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-download"></use></svg><span>Download Project ZIP</span><span id="htmlZipSizeBadge">0 KB</span></button>
          </div>
        </div>
        <div style="margin-top:14px;padding:12px 16px;background:rgba(37,99,235,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;font-size:12px;">
          <strong>Run Locally:</strong> <span id="htmlRunLocallyHint">Unzip and open an HTML file, or serve the folder with any static web server. HTML + Tailwind CDN + local assets. Internet access is required for Tailwind. No npm install or build command is needed. No generated CSS folder, React or node_modules.</span>
        </div>
        <div id="htmlValidationDetails" class="field-hint" style="margin-top:12px;" role="status"></div>
        <div class="file-content-header" style="justify-content:flex-start;gap:8px;" role="tablist" aria-label="Generated HTML project">
          <button type="button" class="history-btn" id="htmlCodeTab" role="tab" aria-selected="false" aria-controls="htmlCodePanel" tabindex="-1" onclick="switchHtmlResultTab('code')" onkeydown="handleHtmlResultTabKey(event, 'code')">Code Preview</button>
          <button type="button" class="history-btn" id="htmlPreviewTab" role="tab" aria-selected="true" aria-controls="htmlPreviewPanel" onclick="switchHtmlResultTab('preview')" onkeydown="handleHtmlResultTabKey(event, 'preview')">Live Preview</button>
        </div>
        <div id="htmlPreviewPanel" role="tabpanel" aria-labelledby="htmlPreviewTab">
          <div class="file-content-header">
            <label class="form-label" for="htmlPreviewPage">Preview page</label>
            <select id="htmlPreviewPage" class="strategy-select" onchange="loadHtmlWebsitePreview()"></select>
          </div>
          <p class="field-hint" id="htmlPreviewStatus" role="status" aria-live="polite"></p>
          <iframe id="htmlPreviewFrame" title="Generated HTML website preview" sandbox="" referrerpolicy="no-referrer" width="100%" height="680" frameborder="0" hidden></iframe>
          <p class="field-hint">Preview of the exported static HTML. Scripts and form submissions are disabled; server-dependent features are not recreated.</p>
        </div>
        <div id="htmlCodePanel" role="tabpanel" aria-labelledby="htmlCodeTab" hidden>
        <div class="explorer-grid">
          <div class="file-tree-pane"><div class="file-tree-title">Project Files (<span id="htmlTotalFilesCount">0</span>)</div><div id="htmlFileTree"></div></div>
          <div class="file-content-pane">
            <div class="file-content-header"><span id="htmlActiveFilePath" class="file-path-badge">index.html</span><button class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="copyHtmlFileContent()">Copy File</button></div>
            <pre class="file-code-view" id="htmlFileContent">Select a file to preview its generated code.</pre>
          </div>
        </div>
        </div>
      </div>
    </section>`;
}

export function renderHtmlGeneratorScript(): string {
  return String.raw`
    const htmlGenerator = { jobId: '', inventory: null, conversionId: '', projectName: '', busy: false, fileRequest: 0, snapshotRequest: 0, progressDisplayed: 0, progressTarget: 0, progressTimer: null, previewBaseUrl: '', previewRequest: 0 };
    const htmlConversionApi = '/api/v1/html-conversions';
    function htmlMessage(message) { document.getElementById('htmlMessage').textContent = message; }
    function updateHtmlCssStrategyHint() {
      document.getElementById('htmlCssStrategyHint').textContent = document.getElementById('htmlCssStrategy').value === 'core'
        ? 'Inline styles become unique CSS classes in external CSS files. Source selectors, responsive rules and hover styling are retained; no Tailwind compilation or installation is required.'
        : 'Source styling becomes Tailwind utility classes, including responsive and interactive variants. No original CSS or fallback stylesheets are retained. Unsupported effects are reported in conversion warnings.';
    }
    async function htmlRequest(url, options = {}) {
      const response = await fetch(url, { ...options, headers: { ...proxyHeaders, ...(options.headers || {}) } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Request failed (' + response.status + ')');
      return body.data;
    }
    function getHtmlProxyRouting() {
      const useProxy = !!document.getElementById('htmlEnableProxy')?.checked;
      const proxyId = useProxy ? document.getElementById('htmlProxySelect')?.value : '';
      if (useProxy && !proxyId) {
        document.getElementById('htmlProxySelect')?.focus();
        throw new Error('Select a saved proxy, or disable proxy routing to use a direct connection.');
      }
      return { useProxy, ...(proxyId ? { proxyId } : {}) };
    }
    function handleHtmlProxyToggle() {
      const enabled = !!document.getElementById('htmlEnableProxy')?.checked;
      const select = document.getElementById('htmlProxySelect');
      if (!select) return;
      select.disabled = htmlGenerator.busy || !enabled;
      select.required = enabled;
      document.getElementById('htmlProxyHint').textContent = !enabled
        ? 'Proxy disabled. Scraping and conversion asset downloads use a direct connection.'
        : select.value ? 'Selected proxy will be used for every page scrape and conversion asset download.' : 'Select a saved proxy, or add one on the Proxies page.';
    }
    async function refreshHtmlProxies() {
      if (htmlGenerator.busy) return;
      const button = document.getElementById('btnHtmlRefreshProxies');
      button.disabled = true;
      try { await loadProxies(); }
      finally { button.disabled = htmlGenerator.busy; }
    }
    function setHtmlBusy(busy) {
      htmlGenerator.busy = busy;
      document.querySelectorAll('#htmlUrlForm input, #htmlUrlForm select, #htmlUrlForm button, #htmlJobSelect, #htmlCssStrategy, #htmlOptionsContainer input, #htmlOptionsContainer select, #htmlOptionsContainer button, #btnHtmlConversion').forEach(el => el.disabled = busy);
      document.getElementById('htmlMaxPages').disabled = busy || document.getElementById('htmlCloneMode').value === 'single';
      handleHtmlProxyToggle();
    }
    function renderHtmlScrapeProgress(phase, job = {}, maxPages = 1, message = '') {
      const batch = htmlGenerator.scrapeBatch;
      if (batch) {
        maxPages = batch.total;
        job = { ...job, totalPagesCrawled: batch.completed + Math.min(1, Math.max(0, Number(job.totalPagesCrawled) || 0)) };
        if (['loading', 'completed', 'partial'].includes(phase) && batch.completed + 1 < batch.total) {
          phase = 'crawling';
          message = 'Page captured. Continuing with the next selected URL...';
        }
      }
      const card = document.getElementById('htmlScrapeProgressCard');
      const track = document.getElementById('htmlScrapeProgressTrack');
      const bar = document.getElementById('htmlScrapeProgressBar');
      card.style.display = 'block';
      const captured = Math.max(0, Number(job.totalPagesCrawled) || 0);
      const failed = phase === 'failed';
      const finished = phase === 'completed' || phase === 'partial';
      const loading = phase === 'loading';
      const indeterminate = !failed && !finished && !loading && (phase !== 'crawling' || captured === 0);
      // The configured page limit is not a known total: do not invent time-based percentages.
      const pct = finished ? 100 : loading ? 95 : Math.min(90, Math.round(captured / maxPages * 90));
      bar.className = (indeterminate ? 'scrape-indeterminate ' : '') + (!failed && !finished ? 'progress-active' : '');
      bar.style.width = indeterminate ? '35%' : pct + '%';
      bar.style.background = failed ? '#f87171' : phase === 'partial' ? '#fbbf24' : '';
      track.setAttribute('aria-busy', String(!failed && !finished));
      if (indeterminate) track.removeAttribute('aria-valuenow');
      else track.setAttribute('aria-valuenow', String(pct));
      const label = failed ? 'Failed' : phase === 'partial' ? 'Partial completion' : finished ? '100%' : loading ? 'Loading pages' : phase === 'crawling' ? 'Crawling' : phase === 'queued' ? 'Queued' : 'Starting';
      document.getElementById('htmlScrapeProgressPercent').textContent = label;
      const detail = message || (phase === 'starting' ? 'Submitting your URL to the scraper...' : phase === 'queued' ? 'Job accepted. Waiting for a crawler to start...' : phase === 'crawling' ? 'Capturing pages and discovering internal links...' : loading ? 'Crawl finished. Loading captured HTML pages...' : 'Captured pages are ready for conversion.');
      const pageCount = captured > maxPages ? captured + ' pages reported by this older crawl (configured limit: ' + maxPages + '; exceeded by ' + (captured - maxPages) + ')' : captured + ' / ' + maxPages + ' page limit captured';
      const status = detail + ' ' + pageCount + (job.id ? ' · Job: ' + job.id : '');
      track.setAttribute('aria-valuetext', status);
      document.getElementById('htmlScrapeProgressStatus').textContent = status;
      const active = phase === 'starting' ? 0 : phase === 'queued' || phase === 'crawling' ? 1 : loading ? 2 : finished ? 3 : htmlGenerator.scrapeStage || 0;
      htmlGenerator.scrapeStage = active;
      const labels = ['Submit URL', 'Crawl & Capture Pages', 'Load Scrape Snapshot'];
      document.getElementById('htmlScrapeStagesList').innerHTML = labels.map((title, index) => {
        const state = failed && index === active ? 'failed' : index < active ? 'completed' : index === active ? 'running' : 'pending';
        return '<div class="stage-item stage-' + state + '"><div class="stage-left"><div class="stage-icon">' + (state === 'completed' ? 'Done' : state === 'failed' ? 'Error' : state === 'running' ? '...' : '-') + '</div><strong>' + escapeHtml(title) + '</strong></div></div>';
      }).join('');
      document.getElementById('btnHtmlScrape').textContent = failed || finished ? 'Scrape URL & Load Pages' : loading ? 'Loading Pages...' : phase === 'starting' ? 'Starting Scrape...' : 'Scraping ' + captured + ' / ' + maxPages;
    }
    let htmlPageRowNumber = 1;
    function addHtmlPageRow() {
      if (htmlGenerator.busy) return;
      const container = document.getElementById('htmlUrlRows');
      if (container.children.length >= 500) { htmlMessage('Maximum 500 page URLs.'); return; }
      const id = ++htmlPageRowNumber;
      const row = document.createElement('div');
      row.className = 'form-group';
      row.innerHTML = '<label class="form-label" for="htmlPageUrl' + id + '">Page URL</label><input id="htmlPageUrl' + id + '" class="proxy-input html-page-url" placeholder="https://example.com/about" required autocomplete="url"><button type="button" class="history-btn" onclick="removeHtmlPageRow(this)" aria-label="Remove this page URL">Remove</button>';
      container.appendChild(row);
      row.querySelector('input').focus();
    }
    function removeHtmlPageRow(button) {
      if (!htmlGenerator.busy) button.closest('.form-group').remove();
    }
    function getHtmlPageUrls() {
      const inputs = Array.from(document.querySelectorAll('#htmlUrlRows .html-page-url'));
      const urls = inputs.map(input => {
        let value = input.value.trim();
        if (!value) throw new Error('Enter a URL in each row or remove the empty row.');
        if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = 'https://' + value;
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a public HTTP or HTTPS URL.');
        url.hash = '';
        input.value = value;
        return url.href;
      });
      if (!urls.length || urls.length > 500) throw new Error('Enter between 1 and 500 page URLs.');
      if (urls.some(url => new URL(url).origin !== new URL(urls[0]).origin)) throw new Error('All pages must belong to the same website.');
      return [...new Set(urls)];
    }
    function handleHtmlScopeChange() {
      document.getElementById('htmlMaxPages').disabled = htmlGenerator.busy || document.getElementById('htmlCloneMode').value === 'single';
    }
    async function populateHtmlJobsList(selectedId = '') {
      try {
        const select = document.getElementById('htmlJobSelect');
        const previous = selectedId || htmlGenerator.jobId || select.value;
        const jobs = await htmlRequest('/api/v1/jobs?limit=50');
        select.innerHTML = '<option value="">-- Select a scraped job --</option>';
        for (const job of jobs) {
          const option = document.createElement('option');
          option.value = job.id;
          option.textContent = (job.name || job.domain || job.targetUrl) + ' (' + (job.totalPagesCrawled || 0) + ' pages, ' + job.status + ')';
          select.appendChild(option);
        }
        if (previous && !Array.from(select.options).some(option => option.value === previous)) {
          const option = document.createElement('option'); option.value = previous; option.textContent = 'Selected snapshot: ' + previous; select.appendChild(option);
        }
        select.value = previous;
      } catch (error) { htmlMessage(error.message); }
    }
    async function loadHtmlSnapshot(jobId = '', internalLoad = false) {
      if (htmlGenerator.busy && !internalLoad) return;
      if (!internalLoad) htmlGenerator.snapshotJobIds = undefined;
      const id = jobId || document.getElementById('htmlJobSelect').value;
      const snapshotRequest = ++htmlGenerator.snapshotRequest;
      htmlGenerator.inventory = null;
      htmlGenerator.jobId = '';
      document.getElementById('htmlOptionsContainer').style.display = 'none';
      document.getElementById('htmlActiveJobBadge').style.display = 'none';
      if (!id) { htmlMessage('Select a scraped job first.'); return; }
      try {
        const inventory = await htmlRequest('/api/v1/jobs/' + encodeURIComponent(id) + '/convert/preview');
        if (snapshotRequest !== htmlGenerator.snapshotRequest) return;
        if (!inventory.pages?.length) throw new Error('No HTML pages are available. Scrape the URL first.');
        htmlGenerator.inventory = inventory;
        htmlGenerator.jobId = id;
        document.getElementById('htmlProjectName').value = ((inventory.domain || 'scraped-site').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 58)) + '-html';
        document.getElementById('htmlJobLabel').textContent = 'Active: ' + inventory.domain + ' (' + inventory.totalPages + ' pages)';
        document.getElementById('htmlActiveJobBadge').style.display = 'inline-flex';
        document.getElementById('htmlOptionsContainer').style.display = 'block';
        renderHtmlPages();
        htmlMessage('Loaded ' + inventory.totalPages + ' captured pages. Full-site exports include only captured, selected pages.');
        return true;
      } catch (error) { if (snapshotRequest === htmlGenerator.snapshotRequest) htmlMessage('Failed to load snapshot: ' + error.message); return false; }
    }
    function renderHtmlPages() {
      const pages = htmlGenerator.inventory?.pages || [];
      document.getElementById('htmlPagesList').innerHTML = pages.map((page, index) =>
        '<tr><td>' + (index + 1) + '</td><td><input aria-label="Include ' + escapeHtml(page.title || page.url) + '" class="html-page-chk" type="checkbox" name="htmlPage" value="' + escapeHtml(page.url) + '" checked></td>' +
        '<td><code>' + escapeHtml(page.route) + '</code></td><td>' + escapeHtml(page.title) + '</td><td>index.html or pages/*.html</td><td>' + escapeHtml(page.url) + '</td></tr>'
      ).join('');
    }
    function toggleHtmlPages(selectAll) {
      const checks = Array.from(document.querySelectorAll('.html-page-chk'));
      checks.forEach(check => check.checked = selectAll);
    }
    async function executeHtmlScrape(event) {
      event.preventDefault();
      if (htmlGenerator.busy) return;
      let urls, routing;
      try { urls = getHtmlPageUrls(); routing = getHtmlProxyRouting(); } catch (error) { htmlMessage(error.message); return; }
      htmlGenerator.snapshotJobIds = [];
      htmlGenerator.scrapeBatch = { total: urls.length, completed: 0 };
      const captured = [];
      setHtmlBusy(true);
      try {
      for (let index = 0; index < urls.length; index++) {
        htmlGenerator.scrapeBatch.completed = index;
        document.getElementById('htmlTargetUrl').value = urls[index];
        document.getElementById('htmlCloneMode').value = 'single';
        const loaded = await scrapeHtmlPage(event, routing);
        if (!loaded) {
          htmlGenerator.scrapeBatch = null;
          htmlGenerator.jobId = '';
          htmlGenerator.snapshotJobIds = undefined;
          htmlGenerator.inventory = null;
          document.getElementById('htmlOptionsContainer').style.display = 'none';
          document.getElementById('htmlTargetUrl').value = urls[0];
          return;
        }
        htmlGenerator.snapshotJobIds.push(htmlGenerator.jobId);
        captured.push(...htmlGenerator.inventory.pages);
      }
      htmlGenerator.scrapeBatch = null;
      const jobs = htmlGenerator.snapshotJobIds;
      const pages = [...new Map(captured.map(page => [page.url, page])).values()];
      htmlGenerator.jobId = jobs[0];
      htmlGenerator.inventory = { ...htmlGenerator.inventory, pages, totalPages: pages.length };
      document.getElementById('htmlTargetUrl').value = urls[0];
      document.getElementById('htmlJobLabel').textContent = 'Selected pages: ' + pages.length;
      renderHtmlPages();
      renderHtmlScrapeProgress('completed', { totalPagesCrawled: pages.length }, urls.length, 'Scrape completed. Selected pages ready to convert.');
      document.getElementById('btnHtmlScrape').textContent = 'Scrape the website';
      htmlMessage('Scrape completed. ' + pages.length + ' / ' + urls.length + ' selected pages ready to convert.');
      } finally { htmlGenerator.scrapeBatch = null; setHtmlBusy(false); }
    }
    async function scrapeHtmlPage(event, batchRouting) {
      event.preventDefault();
      if (htmlGenerator.busy && !batchRouting) return;
      let routing;
      try { routing = batchRouting || getHtmlProxyRouting(); } catch (error) { htmlMessage(error.message); return; }
      const urlInput = document.getElementById('htmlTargetUrl');
      let targetUrl = urlInput.value.trim();
      if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
      try {
        const parsed = new URL(targetUrl);
        if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('Invalid URL');
      } catch { htmlMessage('Enter a valid public HTTP or HTTPS URL.'); return; }
      urlInput.value = targetUrl;
      const full = document.getElementById('htmlCloneMode').value === 'full';
      const limitInput = document.getElementById('htmlMaxPages');
      if (full && !limitInput.reportValidity()) return;
      const maxPages = full ? Number(limitInput.value) : 1;
      if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 500) { htmlMessage('Maximum pages must be an integer from 1 to 500.'); return; }
      setHtmlBusy(true);
      htmlMessage('Starting scrape...');
      let job = {};
      renderHtmlScrapeProgress('starting', job, maxPages);
      try {
        job = await htmlRequest('/api/v1/jobs', { method: 'POST', body: JSON.stringify({
          ...(routing.useProxy ? { proxyId: routing.proxyId } : {}),
          targetUrl, strategy: document.getElementById('htmlStrategy').value,
          maxPages, maxDepth: full ? 10 : 0, requestTimeoutMs: 60000,
          extractionConfig: { extractHtml: true, extractMetadata: true, extractHeadings: true, extractMainText: true, extractLinks: true, extractImages: true, extractJsonLd: true, discoverLinks: full, filterInternalLinksOnly: true, maxLinksPerPage: 500 }
        }) });
        htmlGenerator.jobId = job.id;
        const deadline = Date.now() + 30 * 60 * 1000;
        while (!['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          if (Date.now() > deadline) throw new Error('The crawl is still running. Refresh snapshots later to load job ' + job.id + '.');
          renderHtmlScrapeProgress(job.status === 'RUNNING' ? 'crawling' : 'queued', job, maxPages);
          htmlMessage('Crawling: ' + ((htmlGenerator.scrapeBatch?.completed || 0) + (job.totalPagesCrawled || 0)) + '/' + (htmlGenerator.scrapeBatch?.total || maxPages) + ' pages (' + job.status + ').');
          await new Promise(resolve => setTimeout(resolve, 1200));
          job = await htmlRequest('/api/v1/jobs/' + encodeURIComponent(job.id));
        }
        if (['FAILED', 'CANCELLED'].includes(job.status)) throw new Error(job.errorMessage || 'Scrape ' + job.status.toLowerCase());
        renderHtmlScrapeProgress('loading', job, maxPages);
        await populateHtmlJobsList(job.id);
        const loaded = await loadHtmlSnapshot(job.id, true);
        if (!loaded) throw new Error(document.getElementById('htmlMessage').textContent || 'Could not load captured pages.');
        const partial = job.status === 'PARTIALLY_COMPLETED';
        const completionMessage = partial ? 'Crawl partially completed. Review the captured pages before exporting; some pages could not be captured.' : full && job.totalPagesCrawled >= maxPages ? 'Page limit reached. Only the captured pages will be exported; this is not an exhaustive website copy.' : 'Scrape completed. Captured pages are ready for HTML conversion.';
        renderHtmlScrapeProgress(partial ? 'partial' : 'completed', job, maxPages, completionMessage);
        htmlMessage(completionMessage);
        return true;
      } catch (error) { renderHtmlScrapeProgress('failed', job, maxPages, error.message); htmlMessage(error.message); }
      finally {
        if (!batchRouting) setHtmlBusy(false);
        const batch = htmlGenerator.scrapeBatch;
        document.getElementById('btnHtmlScrape').textContent = batch ? 'Scraping ' + (batch.completed + (job.totalPagesCrawled || 0)) + ' / ' + batch.total : 'Scrape URL & Load Pages';
      }
    }
    async function executeHtmlConversion() {
      if (htmlGenerator.busy) return;
      const pages = Array.from(document.querySelectorAll('.html-page-chk:checked')).map(el => el.value);
      if (!htmlGenerator.jobId || !pages.length) { htmlMessage('Load a snapshot and select at least one page.'); return; }
      const projectInput = document.getElementById('htmlProjectName');
      if (!projectInput.reportValidity()) return;
      let routing;
      try { routing = getHtmlProxyRouting(); } catch (error) { htmlMessage(error.message); return; }
      setHtmlBusy(true);
      resetHtmlWebsitePreview();
      ++htmlGenerator.fileRequest;
      document.getElementById('htmlResultCard').style.display = 'none';
      document.getElementById('htmlProgressCard').style.display = 'block';
      document.getElementById('htmlStagesList').textContent = '';
      document.getElementById('htmlProgressBar').className = 'progress-active';
      resetHtmlConversionProgress();
      const cssStrategy = document.getElementById('htmlCssStrategy').value;
      const startingMessage = cssStrategy === 'core' ? 'Starting HTML + Core CSS conversion...' : 'Starting HTML + Tailwind conversion...';
      setHtmlConversionActivity(true, startingMessage);
      htmlMessage(startingMessage);
      try {
        const started = await htmlRequest('/api/v1/jobs/' + encodeURIComponent(htmlGenerator.jobId) + '/convert/html', { method: 'POST', body: JSON.stringify({ options: {
          ...routing,
          projectName: projectInput.value.trim(), pages, snapshotJobIds: htmlGenerator.snapshotJobIds, cloneMode: pages.length > 1 ? 'full' : 'single', cssStrategy,
          preserveMetadata: document.getElementById('htmlPreserveMetadata').checked,
          preserveInteractivity: document.getElementById('htmlPreserveInteractivity').checked
        } }) });
        htmlGenerator.conversionId = started.id;
        const deadline = Date.now() + 30 * 60 * 1000;
        while (true) {
          if (Date.now() > deadline) throw new Error('Conversion is still running. Conversion ID: ' + started.id);
          const record = await htmlRequest(htmlConversionApi + '/' + encodeURIComponent(started.id));
          renderHtmlStages(record.stages || []);
          if (record.status === 'FAILED') throw new Error(record.errorMessage || 'HTML conversion failed');
          if (record.status === 'COMPLETED') { renderHtmlResults(record); break; }
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (error) { stopHtmlProgressTimer(); htmlMessage('Conversion error: ' + error.message); }
      finally { setHtmlBusy(false); document.getElementById('htmlProgressBar').className = ''; setHtmlConversionActivity(false); }
    }
    function paintHtmlConversionProgress() {
      const value = htmlGenerator.progressDisplayed;
      document.getElementById('htmlProgressBar').style.width = value + '%';
      document.getElementById('htmlProgressPercent').textContent = value + '%';
      document.getElementById('htmlConversionProgressTrack').setAttribute('aria-valuenow', String(value));
    }
    function stopHtmlProgressTimer() {
      if (htmlGenerator.progressTimer !== null) clearInterval(htmlGenerator.progressTimer);
      htmlGenerator.progressTimer = null;
    }
    function resetHtmlConversionProgress() {
      stopHtmlProgressTimer();
      htmlGenerator.progressDisplayed = 0;
      htmlGenerator.progressTarget = 0;
      paintHtmlConversionProgress();
    }
    function animateHtmlConversionProgress(target, failed = false) {
      htmlGenerator.progressTarget = Math.max(htmlGenerator.progressTarget, Math.min(100, Math.round(target)));
      if (failed) { stopHtmlProgressTimer(); return; }
      if (htmlGenerator.progressTimer !== null || htmlGenerator.progressDisplayed >= htmlGenerator.progressTarget) return;
      htmlGenerator.progressTimer = setInterval(() => {
        htmlGenerator.progressDisplayed = Math.min(htmlGenerator.progressDisplayed + 1, htmlGenerator.progressTarget);
        paintHtmlConversionProgress();
        if (htmlGenerator.progressDisplayed >= htmlGenerator.progressTarget) stopHtmlProgressTimer();
      }, 60);
    }
    function setHtmlConversionActivity(active, message) {
      document.getElementById('htmlConversionActivity').hidden = !active;
      document.getElementById('htmlConversionProgressTrack').setAttribute('aria-busy', String(active));
      if (message) document.getElementById('htmlConversionActivityStatus').textContent = message;
    }
    function renderHtmlStages(stages) {
      const pct = stages.length ? Math.round(stages.filter(stage => ['completed', 'skipped'].includes(stage.status)).length / stages.length * 100) : 0;
      const running = stages.find(stage => stage.status === 'running');
      const failed = stages.find(stage => stage.status === 'failed');
      setHtmlConversionActivity(!!running && !failed, failed ? 'Conversion failed: ' + (failed.message || failed.label) : running ? 'In progress: ' + running.label + (running.message ? ' — ' + running.message : '') : pct === 100 ? 'Conversion complete. Project ready to download.' : 'Waiting for the next conversion stage...');
      animateHtmlConversionProgress(pct, !!failed);
      document.getElementById('htmlProgressBar').className = running && !failed ? 'progress-active' : '';
      document.getElementById('htmlStagesList').innerHTML = stages.map(stage => '<div class="stage-item stage-' + escapeHtml(stage.status) + '"><div class="stage-left"><div class="stage-icon">' + (stage.status === 'completed' ? 'Done' : stage.status === 'failed' ? 'Error' : stage.status === 'running' ? '...' : '-') + '</div><div><strong>' + escapeHtml(stage.label) + '</strong><div class="field-hint">' + escapeHtml(stage.message || '') + '</div></div></div><span class="field-hint">' + (stage.durationMs ? (stage.durationMs / 1000).toFixed(1) + 's' : '') + '</span></div>').join('');
    }
    function renderHtmlResults(record) {
      document.getElementById('htmlResultCard').style.display = 'block';
      htmlGenerator.projectName = record.options.projectName;
      document.getElementById('htmlRunLocallyHint').textContent = record.options.cssStrategy === 'core'
        ? 'Unzip and open an HTML file, or serve the folder with any static web server. HTML + external Core CSS + local assets. No npm install, build command or Tailwind tooling is needed.'
        : 'Unzip and open an HTML file, or serve the folder with any static web server. HTML + Tailwind CDN + local assets. Internet access is required for Tailwind. No npm install or build command is needed. No generated CSS folder, React or node_modules.';
      document.getElementById('htmlTotalFilesCount').textContent = String(record.totalFilesGenerated || 0);
      document.getElementById('htmlZipSizeBadge').textContent = ((record.zipSizeBytes || 0) / 1024).toFixed(1) + ' KB';
      const report = record.validationReport;
      const warnings = report?.warnings || record.warnings || [];
      const errors = report?.errors || [];
      const badge = document.getElementById('htmlValidationBadge');
      badge.textContent = report?.passed ? (warnings.length ? 'Validation: Passed with warnings' : 'Validation: Passed') : 'Validation: Issues';
      badge.style.color = report?.passed && !warnings.length ? '#34d399' : '#fbbf24';
      const details = document.getElementById('htmlValidationDetails');
      details.textContent = '';
      if (record.conversionStats) {
        const stats = record.conversionStats;
        const summary = document.createElement('div');
        summary.textContent = record.options.cssStrategy === 'core'
          ? 'Core CSS: ' + stats.inlineDeclarationsConverted + ' inline declarations externalized; ' + stats.declarationsPreserved + ' source stylesheet declarations retained.'
          : 'Tailwind migration: ' + stats.declarationsConverted + '/' + stats.declarationsSeen + ' stylesheet declarations converted; ' + stats.inlineDeclarationsConverted + ' inline declarations converted; ' + stats.declarationsPreserved + ' original CSS declarations retained. Review warnings for unsupported effects.';
        details.appendChild(summary);
      }
      if (record.svgStats?.detected) {
        const summary = document.createElement('div');
        summary.textContent = 'SVG processing: ' + record.svgStats.optimized + ' optimized; ' + record.svgStats.extracted + ' extracted; ' + record.svgStats.reused + ' reused; ' + record.svgStats.assetsCreated + ' assets in assets/svgs/.';
        details.appendChild(summary);
      }
      for (const message of [...errors, ...warnings]) { const line = document.createElement('div'); line.textContent = message; details.appendChild(line); }
      const container = document.getElementById('htmlFileTree'); container.textContent = '';
      if (record.fileTree) container.appendChild(buildHtmlTree(record.fileTree));
      const firstHtml = record.pageFiles?.find(page => page.path === 'index.html')?.path || record.pageFiles?.[0]?.path || findHtmlFile(record.fileTree);
      htmlGenerator.conversionId = record.id;
      if (firstHtml) selectHtmlFile(firstHtml);
      resetHtmlWebsitePreview();
      const pageSelect = document.getElementById('htmlPreviewPage');
      pageSelect.textContent = '';
      const previewPages = record.pageFiles?.length ? record.pageFiles : firstHtml ? [{ path: firstHtml }] : [];
      for (const page of previewPages) {
        const option = document.createElement('option');
        option.value = page.path; option.textContent = page.path;
        pageSelect.appendChild(option);
      }
      pageSelect.value = firstHtml || '';
      switchHtmlResultTab('preview');
      loadHtmlWebsitePreview();
      htmlMessage('HTML project packaged. Review validation warnings for missing assets, residual CSS and dynamic features.');
    }
    function switchHtmlResultTab(tab) {
      for (const name of ['preview', 'code']) {
        const selected = tab === name;
        const button = document.getElementById(name === 'preview' ? 'htmlPreviewTab' : 'htmlCodeTab');
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        button.classList.toggle('active', selected);
        document.getElementById(name === 'preview' ? 'htmlPreviewPanel' : 'htmlCodePanel').hidden = !selected;
      }
    }
    function handleHtmlResultTabKey(event, tab) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 'code' : event.key === 'End' ? 'preview' : tab === 'preview' ? 'code' : 'preview';
      switchHtmlResultTab(next);
      document.getElementById(next === 'preview' ? 'htmlPreviewTab' : 'htmlCodeTab').focus();
    }
    function resetHtmlWebsitePreview() {
      ++htmlGenerator.previewRequest;
      htmlGenerator.previewBaseUrl = '';
      const frame = document.getElementById('htmlPreviewFrame');
      frame.onload = null; frame.onerror = null;
      frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); frame.hidden = true;
    }
    async function loadHtmlWebsitePreview(renewSession = false) {
      const request = ++htmlGenerator.previewRequest;
      const conversionId = htmlGenerator.conversionId;
      const filePath = document.getElementById('htmlPreviewPage').value;
      const frame = document.getElementById('htmlPreviewFrame');
      const status = document.getElementById('htmlPreviewStatus');
      frame.hidden = true;
      if (!conversionId || !filePath) { status.textContent = 'No generated HTML page is available to preview.'; return; }
      status.textContent = 'Loading website preview...';
      try {
        let baseUrl = htmlGenerator.previewBaseUrl;
        if (!baseUrl || renewSession) {
          const session = await htmlRequest(htmlConversionApi + '/' + encodeURIComponent(conversionId) + '/preview', { method: 'POST', body: JSON.stringify({}) });
          baseUrl = session.baseUrl;
        }
        if (request !== htmlGenerator.previewRequest || conversionId !== htmlGenerator.conversionId) return;
        htmlGenerator.previewBaseUrl = baseUrl;
        const url = baseUrl + filePath.split('/').map(encodeURIComponent).join('/');
        // Load HTML through the same authenticated JSON API as Project Files.
        // A separate raw-HTML fetch used to gate the iframe and could prevent any
        // preview from appearing with only an unhelpful "Failed to fetch" message.
        const file = await htmlRequest(htmlConversionApi + '/' + encodeURIComponent(conversionId) + '/files?path=' + encodeURIComponent(filePath));
        if (request !== htmlGenerator.previewRequest) return;
        const previewDocument = new DOMParser().parseFromString(file.content, 'text/html');
        previewDocument.querySelectorAll('base, script, iframe, object, embed').forEach(element => element.remove());
        if (typeof file.previewCss === 'string') {
          const styles = previewDocument.createElement('style');
          styles.textContent = file.previewCss;
          previewDocument.head.appendChild(styles);
        }
        const base = previewDocument.createElement('base');
        base.href = new URL(url, document.baseURI).href;
        previewDocument.head.prepend(base);
        // srcdoc keeps HTML loading independent of the static-resource response.
        // The base URL still resolves nested-page CSS, images, fonts and links to
        // the scoped preview session. Keep executable behavior disabled in depth.
        const policy = previewDocument.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: http: https:; font-src data: http: https:; media-src http: https:; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'";
        previewDocument.head.prepend(policy);
        frame.onload = () => { if (request === htmlGenerator.previewRequest) status.textContent = 'Showing ' + filePath + '. Use the page selector to view other exported pages.'; };
        frame.onerror = () => { if (request === htmlGenerator.previewRequest) status.textContent = 'The preview could not load. Select the page again to retry.'; };
        frame.removeAttribute('src');
        frame.srcdoc = '<!doctype html>\n' + previewDocument.documentElement.outerHTML;
        frame.hidden = false;
      } catch (error) {
        if (request === htmlGenerator.previewRequest) status.textContent = 'Preview unavailable: ' + error.message;
      }
    }
    function findHtmlFile(node) {
      if (!node) return '';
      if (node.type === 'file' && node.path.endsWith('.html')) return node.path;
      for (const child of node.children || []) { const found = findHtmlFile(child); if (found) return found; }
      return '';
    }
    function buildHtmlTree(node) {
      const wrap = document.createElement('div');
      const label = document.createElement(node.type === 'file' ? 'button' : 'div');
      label.className = 'tree-node' + (node.type === 'directory' ? ' tree-dir' : '');
      label.textContent = node.name + (node.type === 'directory' ? '/' : '');
      wrap.appendChild(label);
      if (node.type === 'file') { label.type = 'button'; label.onclick = () => { document.querySelectorAll('#htmlFileTree .tree-node').forEach(el => el.classList.remove('active')); label.classList.add('active'); selectHtmlFile(node.path); }; }
      else { const children = document.createElement('div'); children.style.paddingLeft = '10px'; for (const child of node.children || []) children.appendChild(buildHtmlTree(child)); wrap.appendChild(children); }
      return wrap;
    }
    async function selectHtmlFile(filePath) {
      const request = ++htmlGenerator.fileRequest;
      document.getElementById('htmlActiveFilePath').textContent = filePath;
      document.getElementById('htmlFileContent').textContent = 'Loading...';
      try {
        const file = await htmlRequest(htmlConversionApi + '/' + encodeURIComponent(htmlGenerator.conversionId) + '/files?path=' + encodeURIComponent(filePath));
        if (request === htmlGenerator.fileRequest) document.getElementById('htmlFileContent').textContent = file.content;
      } catch (error) { if (request === htmlGenerator.fileRequest) document.getElementById('htmlFileContent').textContent = 'Preview unavailable (binary file or request error): ' + error.message; }
    }
    async function copyHtmlFileContent() {
      try { await navigator.clipboard.writeText(document.getElementById('htmlFileContent').textContent); htmlMessage('File content copied.'); }
      catch { htmlMessage('Clipboard access failed. Select and copy the code manually.'); }
    }
    async function downloadHtmlZip() {
      if (!htmlGenerator.conversionId) return;
      const button = document.getElementById('btnHtmlDownloadZip'); button.disabled = true;
      try {
        const response = await fetch(htmlConversionApi + '/' + encodeURIComponent(htmlGenerator.conversionId) + '/download', { headers: proxyHeaders });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'Download failed'); }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = (htmlGenerator.projectName || 'html-project') + '.zip'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (error) { htmlMessage('Download error: ' + error.message); }
      finally { button.disabled = false; }
    }
  `;
}
