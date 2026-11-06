export function renderExactCloneHtml(): string {
  return `
    <section class="nextjs-workspace view-hidden" id="exactView" aria-labelledby="exactTitle">
      <style>
        #exactView .tree-node { background:transparent; border:0; text-align:left; width:100%; }
        #exactView .tree-node:hover { background:rgba(255,255,255,0.05); }
        #exactView .tree-node.active { background:rgba(37,99,235,0.2); }
        #exactView .form-group, #exactView .file-content-pane { min-width:0; }
        #exactView .stage-icon { font-size:9px; }
        #exactScrapeProgressTrack { height:6px; background:rgba(255,255,255,0.06); border-radius:999px; margin:14px 0; overflow:hidden; }
        #exactScrapeProgressBar { height:100%; background:linear-gradient(90deg,#3b82f6,#10b981); transition:width 0.3s ease; }
        #exactScrapeProgressBar.scrape-indeterminate { width:35%; animation:exact-scrape-pulse 1.4s ease-in-out infinite alternate; }
        @keyframes exact-scrape-pulse { from { transform:translateX(0); } to { transform:translateX(185%); } }
        #exactScrapeProgressBar, #exactProgressBar { position:relative; overflow:hidden; }
        #exactView .progress-active::after { content:''; position:absolute; inset:0; background:linear-gradient(90deg,transparent,rgba(255,255,255,0.55),transparent); transform:translateX(-100%); animation:exact-progress-shimmer 1.6s linear infinite; }
        @keyframes exact-progress-shimmer { to { transform:translateX(100%); } }
        #exactConversionProgressTrack { position:relative; height:10px; background:rgba(255,255,255,0.06); border-radius:999px; margin:14px 0; overflow:hidden; }
        #exactConversionActivity { position:absolute; inset:0; pointer-events:none; }
        #exactConversionActivity::after { content:''; position:absolute; top:0; bottom:0; width:25%; background:linear-gradient(90deg,transparent,rgba(96,165,250,0.9),rgba(255,255,255,0.75),transparent); animation:exact-conversion-activity 1.8s linear infinite; }
        @keyframes exact-conversion-activity { from { transform:translateX(-100%); } to { transform:translateX(400%); } }
        #exactConversionActivity[hidden] { display:none; }
        #exactValidationDetails { max-height:220px; overflow:auto; overflow-wrap:anywhere; }
        @media (prefers-reduced-motion:reduce) {
          #exactScrapeProgressBar, #exactProgressBar { animation:none; transition:none !important; }
          #exactView .progress-active::after { animation:none; transform:none; opacity:0.3; }
          #exactConversionActivity::after { animation:none; transform:none; opacity:0.3; }
        }
        @media (max-width:900px) {
          #exactView .options-grid, #exactView .explorer-grid { grid-template-columns:minmax(0,1fr); }
          #exactView .file-tree-pane { max-height:260px; overflow:auto; border-right:0; border-bottom:1px solid var(--border); }
          #exactView .btn-download-hero { flex-wrap:wrap; }
        }
      </style>
      <div class="nextjs-header"><div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
        <div><h1 class="nextjs-title" id="exactTitle">Exact clone</h1>
        <p class="nextjs-copy">Enter the page URLs you want to clone, or load a saved scrape snapshot. Capture uses Playwright and exports static HTML with original CSS preserved without a styling conversion, plus local images and fonts. Source application scripts and backend behavior are not restored.</p></div>
        <div id="exactActiveJobBadge" class="badge-nextjs" style="display:none;"><span id="exactJobLabel">Job Selected</span></div>
      </div></div>
      <div class="card" style="margin-bottom:20px;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <span><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-bolt"></use></svg> 1. Select URL or Scrape Snapshot &amp; Output Options</span>
          <button class="btn-reset" style="margin-top:0;padding:5px 12px;font-size:11px;" onclick="populateExactJobsList()">Refresh from Scraper</button>
        </div>
        <form id="exactUrlForm" onsubmit="executeExactScrape(event)" style="margin-top:14px;">
          <div id="exactUrlRows"><div class="form-group">
            <label class="form-label" for="exactTargetUrl">Page URL · Entry page</label>
            <input id="exactTargetUrl" class="proxy-input exact-page-url" placeholder="https://example.com" required autocomplete="url" style="margin-top:0;">
            <div class="field-hint">Enter a public URL, for example soundcloud.com. Only clone sites you have permission to reproduce.</div>
          </div></div>
          <button id="btnExactAddPage" type="button" class="history-btn" onclick="addExactPageRow()" aria-label="Add another page URL">+ Add page</button>
          <div class="field-hint">Only these URLs will be scraped. Add up to 500 pages from the same website.</div>
          <div style="display:flex;justify-content:flex-end;"><button id="btnExactScrape" class="btn-submit" type="submit" style="max-width:280px;height:44px;margin-top:0;">Scrape the website</button></div>
        </form>
        <div id="exactScrapeProgressCard" class="card" style="display:none;margin-top:20px;" aria-labelledby="exactScrapeProgressTitle">
          <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;"><span id="exactScrapeProgressTitle">Scrape Pipeline Progress</span><span id="exactScrapeProgressPercent" class="badge-status">Starting</span></div>
          <div id="exactScrapeProgressTrack" role="progressbar" aria-label="Website scrape progress" aria-valuemin="0" aria-valuemax="100"><div id="exactScrapeProgressBar"></div></div>
          <p id="exactScrapeProgressStatus" class="field-hint" role="status" aria-live="polite"></p><div class="stages-list" id="exactScrapeStagesList"></div>
        </div>
        <p id="exactMessage" class="field-hint" role="status" aria-live="polite"></p>
        <div class="options-grid" style="margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <div class="form-group"><label class="form-label" for="exactJobSelect">Target Scrape Job</label><select id="exactJobSelect" class="strategy-select" onchange="loadExactSnapshot()"><option value="">-- Select a scraped job --</option></select></div>
          <div class="form-group" style="display:flex;align-items:end;"><button class="btn-submit" style="height:44px;margin-top:0;" onclick="loadExactSnapshot()">Load Snapshot</button></div>
        </div>
        <div id="exactOptionsContainer" style="display:none;margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <div class="options-grid">
            <div class="form-group"><label class="form-label" for="exactProjectName">Project Name</label><input id="exactProjectName" class="proxy-input" value="scraped-exact-site" pattern="[a-zA-Z0-9_-]+" maxlength="64" required style="margin-top:0;"><div class="field-hint">Alphanumeric, hyphens and underscores. Download archive name.</div></div>
            <div class="form-group"><label class="form-label">Advanced Preservation</label><div class="toggle-group" style="margin-top:4px;">
              <label class="toggle-item"><input type="checkbox" id="exactPreserveInteractivity" class="toggle-checkbox" checked><span class="toggle-label">Native HTML Controls</span></label>
              <label class="toggle-item"><input type="checkbox" id="exactPreserveMetadata" class="toggle-checkbox" checked><span class="toggle-label">SEO Metadata</span></label>
            </div><div class="field-hint">Native links and controls can work offline. Login, search, playback and other server-dependent behavior are not recreated.</div></div>
          </div>
          <div style="margin-top:24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;"><label class="form-label" style="margin-bottom:0;">Pages &amp; HTML Files to Include</label><div style="display:flex;gap:8px;"><button type="button" class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="toggleExactPages(true)">Select All</button><button type="button" class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="toggleExactPages(false)">Deselect All</button></div></div>
            <div style="border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:260px;background:var(--card-inner);"><table class="pages-table" id="exactPagesTable"><thead><tr><th style="width:48px;">No.</th><th style="width:40px;">Inc</th><th>Route</th><th>Page Title</th><th>Output</th><th>Source URL</th></tr></thead><tbody id="exactPagesList"></tbody></table></div>
          </div>
          <div style="margin-top:24px;display:flex;justify-content:flex-end;"><button id="btnExactConversion" class="btn-submit" style="max-width:280px;height:48px;font-size:14px;gap:8px;" onclick="executeExactConversion()"><svg class="icon" aria-hidden="true"><use href="#icon-bolt"></use></svg><span>Create Exact clone</span></button></div>
        </div>
      </div>
      <div id="exactProgressCard" class="card" style="display:none;margin-bottom:20px;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;"><span>2. Conversion Pipeline Stages</span><span id="exactProgressPercent" class="badge-status">0%</span></div>
        <div id="exactConversionProgressTrack" role="progressbar" aria-label="Exact conversion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="exactProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #3b82f6, #10b981);transition:width 0.3s ease;"></div><div id="exactConversionActivity" hidden></div></div>
        <p id="exactConversionActivityStatus" class="field-hint" role="status" aria-live="polite"></p><div class="stages-list" id="exactStagesList"></div>
      </div>
      <div id="exactResultCard" class="card" style="display:none;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;"><span>3. Generated Project Preview &amp; Export</span><div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;"><span id="exactValidationBadge" class="badge-status">Validation</span><button id="btnExactDownloadZip" class="btn-download-hero" onclick="downloadExactZip()"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-download"></use></svg><span>Download Project ZIP</span><span id="exactZipSizeBadge">0 KB</span></button></div></div>
        <div style="margin-top:14px;padding:12px 16px;background:rgba(37,99,235,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;font-size:12px;"><strong>Run Locally:</strong> Unzip and open an HTML file, or serve the folder with any static web server. Static HTML + original CSS + local assets. No npm install needed. Source scripts, login, search and other backend-dependent behavior are not restored.</div>
        <div id="exactValidationDetails" class="field-hint" style="margin-top:12px;" role="status"></div>
        <div class="file-content-header" style="justify-content:flex-start;gap:8px;" role="tablist" aria-label="Generated exact project">
          <button type="button" class="history-btn" id="exactCodeTab" role="tab" aria-selected="false" aria-controls="exactCodePanel" tabindex="-1" onclick="switchExactResultTab('code')" onkeydown="handleExactResultTabKey(event, 'code')">Code Preview</button>
          <button type="button" class="history-btn" id="exactPreviewTab" role="tab" aria-selected="true" aria-controls="exactPreviewPanel" onclick="switchExactResultTab('preview')" onkeydown="handleExactResultTabKey(event, 'preview')">Live Preview</button>
        </div>
        <div id="exactPreviewPanel" role="tabpanel" aria-labelledby="exactPreviewTab"><div class="file-content-header"><label class="form-label" for="exactPreviewPage">Preview page</label><select id="exactPreviewPage" class="strategy-select" onchange="loadExactWebsitePreview()"></select></div>
          <p class="field-hint" id="exactPreviewStatus" role="status" aria-live="polite"></p><iframe id="exactPreviewFrame" title="Generated exact website preview" sandbox="" referrerpolicy="no-referrer" width="100%" height="680" frameborder="0" hidden></iframe>
          <p class="field-hint">Preview of the exported static HTML. Scripts and form submissions are disabled; server-dependent features are not recreated.</p>
        </div>
        <div id="exactCodePanel" role="tabpanel" aria-labelledby="exactCodeTab" hidden><div class="explorer-grid">
          <div class="file-tree-pane"><div class="file-tree-title">Project Files (<span id="exactTotalFilesCount">0</span>)</div><div id="exactFileTree"></div></div>
          <div class="file-content-pane"><div class="file-content-header"><span id="exactActiveFilePath" class="file-path-badge">index.html</span><button class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="copyExactFileContent()">Copy File</button></div><pre class="file-code-view" id="exactFileContent">Select a file to preview its generated code.</pre></div>
        </div></div>
      </div>
    </section>`;
}

export function renderExactCloneScript(): string {
  return String.raw`
    const exactGenerator = { jobId: '', inventory: null, conversionId: '', projectName: '', busy: false, fileRequest: 0, snapshotRequest: 0, progressDisplayed: 0, progressTarget: 0, progressTimer: null, previewBaseUrl: '', previewRequest: 0 };
    const exactConversionApi = '/api/v1/exact-conversions';
    function exactMessage(message) { document.getElementById('exactMessage').textContent = message; }
    async function exactRequest(url, options = {}) {
      const response = await fetch(url, { ...options, headers: { ...proxyHeaders, ...(options.headers || {}) } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Request failed (' + response.status + ')');
      return body.data;
    }
    function setExactBusy(busy) {
      exactGenerator.busy = busy;
      document.querySelectorAll('#exactUrlForm input, #exactUrlForm button, #exactJobSelect, #exactOptionsContainer input, #exactOptionsContainer select, #exactOptionsContainer button, #btnExactConversion').forEach(el => el.disabled = busy);
    }
    function renderExactScrapeProgress(phase, job = {}, maxPages = 1, message = '') {
      const batch = exactGenerator.scrapeBatch;
      if (batch) {
        maxPages = batch.total;
        job = { ...job, totalPagesCrawled: batch.completed + Math.min(1, Math.max(0, Number(job.totalPagesCrawled) || 0)) };
        if (['loading', 'completed', 'partial'].includes(phase) && batch.completed + 1 < batch.total) { phase = 'crawling'; message = 'Page captured. Continuing with the next selected URL...'; }
      }
      const card = document.getElementById('exactScrapeProgressCard');
      const track = document.getElementById('exactScrapeProgressTrack');
      const bar = document.getElementById('exactScrapeProgressBar');
      card.style.display = 'block';
      const captured = Math.max(0, Number(job.totalPagesCrawled) || 0);
      const failed = phase === 'failed';
      const finished = phase === 'completed' || phase === 'partial';
      const loading = phase === 'loading';
      const indeterminate = !failed && !finished && !loading && (phase !== 'crawling' || captured === 0);
      const pct = finished ? 100 : loading ? 95 : Math.min(90, Math.round(captured / maxPages * 90));
      bar.className = (indeterminate ? 'scrape-indeterminate ' : '') + (!failed && !finished ? 'progress-active' : '');
      bar.style.width = indeterminate ? '35%' : pct + '%';
      bar.style.background = failed ? '#f87171' : phase === 'partial' ? '#fbbf24' : '';
      track.setAttribute('aria-busy', String(!failed && !finished));
      if (indeterminate) track.removeAttribute('aria-valuenow'); else track.setAttribute('aria-valuenow', String(pct));
      document.getElementById('exactScrapeProgressPercent').textContent = failed ? 'Failed' : phase === 'partial' ? 'Partial completion' : finished ? '100%' : loading ? 'Loading pages' : phase === 'crawling' ? 'Crawling' : phase === 'queued' ? 'Queued' : 'Starting';
      const detail = message || (phase === 'starting' ? 'Submitting your URL to the scraper...' : phase === 'queued' ? 'Job accepted. Waiting for a crawler to start...' : phase === 'crawling' ? 'Capturing the selected page...' : loading ? 'Capture finished. Loading saved HTML...' : 'Captured pages are ready for conversion.');
      const status = detail + ' ' + captured + ' / ' + maxPages + ' pages captured' + (job.id ? ' · Job: ' + job.id : '');
      track.setAttribute('aria-valuetext', status);
      document.getElementById('exactScrapeProgressStatus').textContent = status;
      const active = phase === 'starting' ? 0 : phase === 'queued' || phase === 'crawling' ? 1 : loading ? 2 : finished ? 3 : exactGenerator.scrapeStage || 0;
      exactGenerator.scrapeStage = active;
      document.getElementById('exactScrapeStagesList').innerHTML = ['Submit URL', 'Capture Page', 'Load Scrape Snapshot'].map((title, index) => {
        const state = failed && index === active ? 'failed' : index < active ? 'completed' : index === active ? 'running' : 'pending';
        return '<div class="stage-item stage-' + state + '"><div class="stage-left"><div class="stage-icon">' + (state === 'completed' ? 'Done' : state === 'failed' ? 'Error' : state === 'running' ? '...' : '-') + '</div><strong>' + escapeHtml(title) + '</strong></div></div>';
      }).join('');
      document.getElementById('btnExactScrape').textContent = failed || finished ? 'Scrape URL & Load Pages' : loading ? 'Loading Pages...' : phase === 'starting' ? 'Starting Scrape...' : 'Scraping ' + captured + ' / ' + maxPages;
    }
    let exactPageRowNumber = 1;
    function addExactPageRow() {
      if (exactGenerator.busy) return;
      const container = document.getElementById('exactUrlRows');
      if (container.children.length >= 500) { exactMessage('Maximum 500 page URLs.'); return; }
      const id = ++exactPageRowNumber;
      const row = document.createElement('div'); row.className = 'form-group';
      row.innerHTML = '<label class="form-label" for="exactPageUrl' + id + '">Page URL</label><input id="exactPageUrl' + id + '" class="proxy-input exact-page-url" placeholder="https://example.com/about" required autocomplete="url"><button type="button" class="history-btn" onclick="removeExactPageRow(this)" aria-label="Remove this page URL">Remove</button>';
      container.appendChild(row); row.querySelector('input').focus();
    }
    function removeExactPageRow(button) { if (!exactGenerator.busy) button.closest('.form-group').remove(); }
    function getExactPageUrls() {
      const urls = Array.from(document.querySelectorAll('#exactUrlRows .exact-page-url')).map(input => {
        let value = input.value.trim();
        if (!value) throw new Error('Enter a URL in each row or remove the empty row.');
        if (!/^[a-z][a-z\d+.-]*:/i.test(value)) value = 'https://' + value;
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Enter a public HTTP or HTTPS URL.');
        url.hash = ''; input.value = value; return url.href;
      });
      if (!urls.length || urls.length > 500) throw new Error('Enter between 1 and 500 page URLs.');
      if (urls.some(url => new URL(url).origin !== new URL(urls[0]).origin)) throw new Error('All pages must belong to the same website.');
      return [...new Set(urls)];
    }
    async function populateExactJobsList(selectedId = '') {
      try {
        const select = document.getElementById('exactJobSelect');
        const previous = selectedId || exactGenerator.jobId || select.value;
        const jobs = await exactRequest('/api/v1/jobs?limit=50');
        select.innerHTML = '<option value="">-- Select a scraped job --</option>';
        for (const job of jobs) {
          const option = document.createElement('option'); option.value = job.id;
          option.textContent = (job.name || job.domain || job.targetUrl) + ' (' + (job.totalPagesCrawled || 0) + ' pages, ' + job.status + ')'; select.appendChild(option);
        }
        if (previous && !Array.from(select.options).some(option => option.value === previous)) {
          const option = document.createElement('option'); option.value = previous; option.textContent = 'Selected snapshot: ' + previous; select.appendChild(option);
        }
        select.value = previous;
      } catch (error) { exactMessage(error.message); }
    }
    async function loadExactSnapshot(jobId = '', internalLoad = false) {
      if (exactGenerator.busy && !internalLoad) return;
      if (!internalLoad) exactGenerator.snapshotJobIds = undefined;
      const id = jobId || document.getElementById('exactJobSelect').value;
      const snapshotRequest = ++exactGenerator.snapshotRequest;
      exactGenerator.inventory = null; exactGenerator.jobId = '';
      document.getElementById('exactOptionsContainer').style.display = 'none'; document.getElementById('exactActiveJobBadge').style.display = 'none';
      if (!id) { exactMessage('Select a scraped job first.'); return; }
      try {
        const inventory = await exactRequest('/api/v1/jobs/' + encodeURIComponent(id) + '/convert/exact/preview');
        if (snapshotRequest !== exactGenerator.snapshotRequest) return;
        if (!inventory.pages?.length) throw new Error('No HTML pages are available. Scrape the URL first.');
        exactGenerator.inventory = inventory; exactGenerator.jobId = id;
        document.getElementById('exactProjectName').value = ((inventory.domain || 'scraped-site').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 58)) + '-exact';
        document.getElementById('exactJobLabel').textContent = 'Active: ' + inventory.domain + ' (' + inventory.totalPages + ' pages)';
        document.getElementById('exactActiveJobBadge').style.display = 'inline-flex'; document.getElementById('exactOptionsContainer').style.display = 'block';
        renderExactPages(); exactMessage('Loaded ' + inventory.totalPages + ' captured pages. Exports include only captured, selected pages.'); return true;
      } catch (error) { if (snapshotRequest === exactGenerator.snapshotRequest) exactMessage('Failed to load snapshot: ' + error.message); return false; }
    }
    function renderExactPages() {
      document.getElementById('exactPagesList').innerHTML = (exactGenerator.inventory?.pages || []).map((page, index) =>
        '<tr><td>' + (index + 1) + '</td><td><input aria-label="Include ' + escapeHtml(page.title || page.url) + '" class="exact-page-chk" type="checkbox" name="exactPage" value="' + escapeHtml(page.url) + '" checked></td><td><code>' + escapeHtml(page.route) + '</code></td><td>' + escapeHtml(page.title) + '</td><td>index.html or pages/*.html</td><td>' + escapeHtml(page.url) + '</td></tr>'
      ).join('');
    }
    function toggleExactPages(selectAll) { document.querySelectorAll('.exact-page-chk').forEach(check => check.checked = selectAll); }
    async function executeExactScrape(event) {
      event.preventDefault(); if (exactGenerator.busy) return;
      let urls; try { urls = getExactPageUrls(); } catch (error) { exactMessage(error.message); return; }
      exactGenerator.snapshotJobIds = []; exactGenerator.scrapeBatch = { total: urls.length, completed: 0 };
      const captured = [];
      for (let index = 0; index < urls.length; index++) {
        exactGenerator.scrapeBatch.completed = index; document.getElementById('exactTargetUrl').value = urls[index];
        const loaded = await scrapeExactPage(event);
        if (!loaded) {
          exactGenerator.scrapeBatch = null; exactGenerator.jobId = ''; exactGenerator.snapshotJobIds = undefined; exactGenerator.inventory = null;
          document.getElementById('exactOptionsContainer').style.display = 'none'; document.getElementById('exactTargetUrl').value = urls[0]; return;
        }
        exactGenerator.snapshotJobIds.push(exactGenerator.jobId); captured.push(...exactGenerator.inventory.pages);
      }
      exactGenerator.scrapeBatch = null;
      const pages = [...new Map(captured.map(page => [page.url, page])).values()];
      exactGenerator.jobId = exactGenerator.snapshotJobIds[0]; exactGenerator.inventory = { ...exactGenerator.inventory, pages, totalPages: pages.length };
      document.getElementById('exactTargetUrl').value = urls[0]; document.getElementById('exactJobLabel').textContent = 'Selected pages: ' + pages.length;
      renderExactPages(); renderExactScrapeProgress('completed', { totalPagesCrawled: pages.length }, urls.length, 'Scrape completed. Selected pages ready to clone.');
      document.getElementById('btnExactScrape').textContent = 'Scrape the website'; exactMessage('Scrape completed. ' + pages.length + ' / ' + urls.length + ' selected pages ready to clone.');
    }
    async function scrapeExactPage(event) {
      event.preventDefault(); if (exactGenerator.busy) return;
      const urlInput = document.getElementById('exactTargetUrl');
      let targetUrl = urlInput.value.trim(); if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;
      try { const parsed = new URL(targetUrl); if (!['https:', 'http:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error('Invalid URL'); }
      catch { exactMessage('Enter a valid public HTTP or HTTPS URL.'); return; }
      urlInput.value = targetUrl; setExactBusy(true); exactMessage('Starting scrape...');
      let job = {}; renderExactScrapeProgress('starting', job, 1);
      try {
        job = await exactRequest('/api/v1/jobs', { method: 'POST', body: JSON.stringify({
          targetUrl, strategy: 'PLAYWRIGHT', maxPages: 1, maxDepth: 0, requestTimeoutMs: 60000,
          extractionConfig: { extractHtml: true, extractMetadata: true, extractHeadings: true, extractMainText: true, extractLinks: true, extractImages: true, extractJsonLd: true, discoverLinks: false, filterInternalLinksOnly: true, maxLinksPerPage: 500 }
        }) });
        exactGenerator.jobId = job.id; const deadline = Date.now() + 30 * 60 * 1000;
        while (!['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          if (Date.now() > deadline) throw new Error('The crawl is still running. Refresh snapshots later to load job ' + job.id + '.');
          renderExactScrapeProgress(job.status === 'RUNNING' ? 'crawling' : 'queued', job, 1);
          exactMessage('Capturing: ' + ((exactGenerator.scrapeBatch?.completed || 0) + (job.totalPagesCrawled || 0)) + '/' + (exactGenerator.scrapeBatch?.total || 1) + ' pages (' + job.status + ').');
          await new Promise(resolve => setTimeout(resolve, 1200)); job = await exactRequest('/api/v1/jobs/' + encodeURIComponent(job.id));
        }
        if (['FAILED', 'CANCELLED'].includes(job.status)) throw new Error(job.errorMessage || 'Scrape ' + job.status.toLowerCase());
        renderExactScrapeProgress('loading', job, 1); await populateExactJobsList(job.id);
        if (!await loadExactSnapshot(job.id, true)) throw new Error(document.getElementById('exactMessage').textContent || 'Could not load captured pages.');
        const partial = job.status === 'PARTIALLY_COMPLETED';
        const message = partial ? 'Capture partially completed. Review captured pages before exporting.' : 'Scrape completed. Captured page is ready to clone.';
        renderExactScrapeProgress(partial ? 'partial' : 'completed', job, 1, message); exactMessage(message); return true;
      } catch (error) { renderExactScrapeProgress('failed', job, 1, error.message); exactMessage(error.message); }
      finally { setExactBusy(false); const batch = exactGenerator.scrapeBatch; document.getElementById('btnExactScrape').textContent = batch ? 'Scraping ' + (batch.completed + (job.totalPagesCrawled || 0)) + ' / ' + batch.total : 'Scrape URL & Load Pages'; }
    }
    async function executeExactConversion() {
      if (exactGenerator.busy) return;
      const pages = Array.from(document.querySelectorAll('.exact-page-chk:checked')).map(el => el.value);
      if (!exactGenerator.jobId || !pages.length) { exactMessage('Load a snapshot and select at least one page.'); return; }
      const projectInput = document.getElementById('exactProjectName'); if (!projectInput.reportValidity()) return;
      setExactBusy(true); resetExactWebsitePreview(); ++exactGenerator.fileRequest;
      document.getElementById('exactResultCard').style.display = 'none'; document.getElementById('exactProgressCard').style.display = 'block';
      document.getElementById('exactStagesList').textContent = ''; document.getElementById('exactProgressBar').className = 'progress-active';
      resetExactConversionProgress(); setExactConversionActivity(true, 'Starting Exact clone with original CSS...'); exactMessage('Starting Exact clone with original CSS...');
      try {
        const started = await exactRequest('/api/v1/jobs/' + encodeURIComponent(exactGenerator.jobId) + '/convert/exact', { method: 'POST', body: JSON.stringify({ options: {
          projectName: projectInput.value.trim(), pages, snapshotJobIds: exactGenerator.snapshotJobIds, cloneMode: pages.length > 1 ? 'full' : 'single',
          preserveMetadata: document.getElementById('exactPreserveMetadata').checked, preserveInteractivity: document.getElementById('exactPreserveInteractivity').checked
        } }) });
        exactGenerator.conversionId = started.id; const deadline = Date.now() + 30 * 60 * 1000;
        while (true) {
          if (Date.now() > deadline) throw new Error('Conversion is still running. Conversion ID: ' + started.id);
          const record = await exactRequest(exactConversionApi + '/' + encodeURIComponent(started.id)); renderExactStages(record.stages || []);
          if (record.status === 'FAILED') throw new Error(record.errorMessage || 'Exact conversion failed');
          if (record.status === 'COMPLETED') { renderExactResults(record); break; }
          await new Promise(resolve => setTimeout(resolve, 800));
        }
      } catch (error) { stopExactProgressTimer(); exactMessage('Conversion error: ' + error.message); }
      finally { setExactBusy(false); document.getElementById('exactProgressBar').className = ''; setExactConversionActivity(false); }
    }
    function paintExactConversionProgress() {
      const value = exactGenerator.progressDisplayed; document.getElementById('exactProgressBar').style.width = value + '%';
      document.getElementById('exactProgressPercent').textContent = value + '%'; document.getElementById('exactConversionProgressTrack').setAttribute('aria-valuenow', String(value));
    }
    function stopExactProgressTimer() { if (exactGenerator.progressTimer !== null) clearInterval(exactGenerator.progressTimer); exactGenerator.progressTimer = null; }
    function resetExactConversionProgress() { stopExactProgressTimer(); exactGenerator.progressDisplayed = 0; exactGenerator.progressTarget = 0; paintExactConversionProgress(); }
    function animateExactConversionProgress(target, failed = false) {
      exactGenerator.progressTarget = Math.max(exactGenerator.progressTarget, Math.min(100, Math.round(target)));
      if (failed) { stopExactProgressTimer(); return; }
      if (exactGenerator.progressTimer !== null || exactGenerator.progressDisplayed >= exactGenerator.progressTarget) return;
      exactGenerator.progressTimer = setInterval(() => {
        exactGenerator.progressDisplayed = Math.min(exactGenerator.progressDisplayed + 1, exactGenerator.progressTarget); paintExactConversionProgress();
        if (exactGenerator.progressDisplayed >= exactGenerator.progressTarget) stopExactProgressTimer();
      }, 60);
    }
    function setExactConversionActivity(active, message) {
      document.getElementById('exactConversionActivity').hidden = !active; document.getElementById('exactConversionProgressTrack').setAttribute('aria-busy', String(active));
      if (message) document.getElementById('exactConversionActivityStatus').textContent = message;
    }
    function renderExactStages(stages) {
      const pct = stages.length ? Math.round(stages.filter(stage => ['completed', 'skipped'].includes(stage.status)).length / stages.length * 100) : 0;
      const running = stages.find(stage => stage.status === 'running'); const failed = stages.find(stage => stage.status === 'failed');
      setExactConversionActivity(!!running && !failed, failed ? 'Conversion failed: ' + (failed.message || failed.label) : running ? 'In progress: ' + running.label + (running.message ? ' — ' + running.message : '') : pct === 100 ? 'Conversion complete. Project ready to download.' : 'Waiting for the next conversion stage...');
      animateExactConversionProgress(pct, !!failed); document.getElementById('exactProgressBar').className = running && !failed ? 'progress-active' : '';
      document.getElementById('exactStagesList').innerHTML = stages.map(stage => '<div class="stage-item stage-' + escapeHtml(stage.status) + '"><div class="stage-left"><div class="stage-icon">' + (stage.status === 'completed' ? 'Done' : stage.status === 'failed' ? 'Error' : stage.status === 'running' ? '...' : '-') + '</div><div><strong>' + escapeHtml(stage.label) + '</strong><div class="field-hint">' + escapeHtml(stage.message || '') + '</div></div></div><span class="field-hint">' + (stage.durationMs ? (stage.durationMs / 1000).toFixed(1) + 's' : '') + '</span></div>').join('');
    }
    function renderExactResults(record) {
      document.getElementById('exactResultCard').style.display = 'block'; exactGenerator.projectName = record.options.projectName;
      document.getElementById('exactTotalFilesCount').textContent = String(record.totalFilesGenerated || 0); document.getElementById('exactZipSizeBadge').textContent = ((record.zipSizeBytes || 0) / 1024).toFixed(1) + ' KB';
      const report = record.validationReport; const warnings = report?.warnings || record.warnings || []; const errors = report?.errors || [];
      const badge = document.getElementById('exactValidationBadge'); badge.textContent = report?.passed ? (warnings.length ? 'Validation: Passed with warnings' : 'Validation: Passed') : 'Validation: Issues'; badge.style.color = report?.passed && !warnings.length ? '#34d399' : '#fbbf24';
      const details = document.getElementById('exactValidationDetails'); details.textContent = '';
      if (record.svgStats?.detected) { const summary = document.createElement('div'); summary.textContent = 'SVG preservation: ' + record.svgStats.keptInline + ' kept inline without optimization or extraction.'; details.appendChild(summary); }
      for (const message of [...errors, ...warnings]) { const line = document.createElement('div'); line.textContent = message; details.appendChild(line); }
      const container = document.getElementById('exactFileTree'); container.textContent = ''; if (record.fileTree) container.appendChild(buildExactTree(record.fileTree));
      const firstExact = record.pageFiles?.find(page => page.path === 'index.html')?.path || record.pageFiles?.[0]?.path || findExactFile(record.fileTree);
      exactGenerator.conversionId = record.id; if (firstExact) selectExactFile(firstExact); resetExactWebsitePreview();
      const pageSelect = document.getElementById('exactPreviewPage'); pageSelect.textContent = '';
      for (const page of record.pageFiles?.length ? record.pageFiles : firstExact ? [{ path: firstExact }] : []) { const option = document.createElement('option'); option.value = page.path; option.textContent = page.path; pageSelect.appendChild(option); }
      pageSelect.value = firstExact || ''; switchExactResultTab('preview'); loadExactWebsitePreview();
      exactMessage('Exact clone packaged with original CSS. Review validation warnings for missing assets and dynamic features. Source scripts and backend behavior are not restored.');
    }
    function switchExactResultTab(tab) {
      for (const name of ['preview', 'code']) {
        const selected = tab === name; const button = document.getElementById(name === 'preview' ? 'exactPreviewTab' : 'exactCodeTab');
        button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; button.classList.toggle('active', selected);
        document.getElementById(name === 'preview' ? 'exactPreviewPanel' : 'exactCodePanel').hidden = !selected;
      }
    }
    function handleExactResultTabKey(event, tab) {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault();
      const next = event.key === 'Home' ? 'code' : event.key === 'End' ? 'preview' : tab === 'preview' ? 'code' : 'preview';
      switchExactResultTab(next); document.getElementById(next === 'preview' ? 'exactPreviewTab' : 'exactCodeTab').focus();
    }
    function resetExactWebsitePreview() {
      ++exactGenerator.previewRequest; exactGenerator.previewBaseUrl = ''; const frame = document.getElementById('exactPreviewFrame');
      frame.onload = null; frame.onerror = null; frame.removeAttribute('src'); frame.removeAttribute('srcdoc'); frame.hidden = true;
    }
    async function loadExactWebsitePreview(renewSession = false) {
      const request = ++exactGenerator.previewRequest; const conversionId = exactGenerator.conversionId;
      const filePath = document.getElementById('exactPreviewPage').value; const frame = document.getElementById('exactPreviewFrame'); const status = document.getElementById('exactPreviewStatus');
      frame.hidden = true; if (!conversionId || !filePath) { status.textContent = 'No generated HTML page is available to preview.'; return; } status.textContent = 'Loading website preview...';
      try {
        let baseUrl = exactGenerator.previewBaseUrl;
        if (!baseUrl || renewSession) { const session = await exactRequest(exactConversionApi + '/' + encodeURIComponent(conversionId) + '/preview', { method: 'POST', body: JSON.stringify({}) }); baseUrl = session.baseUrl; }
        if (request !== exactGenerator.previewRequest || conversionId !== exactGenerator.conversionId) return;
        exactGenerator.previewBaseUrl = baseUrl; const url = baseUrl + filePath.split('/').map(encodeURIComponent).join('/');
        const file = await exactRequest(exactConversionApi + '/' + encodeURIComponent(conversionId) + '/files?path=' + encodeURIComponent(filePath));
        if (request !== exactGenerator.previewRequest) return;
        const previewDocument = new DOMParser().parseFromString(file.content, 'text/html'); previewDocument.querySelectorAll('base, script, iframe, object, embed').forEach(element => element.remove());
        const base = previewDocument.createElement('base'); base.href = new URL(url, document.baseURI).href; previewDocument.head.prepend(base);
        const policy = previewDocument.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; style-src 'unsafe-inline' http: https:; img-src data: http: https:; font-src data: http: https:; media-src http: https:; script-src 'none'; frame-src 'none'; connect-src 'none'; form-action 'none'"; previewDocument.head.prepend(policy);
        frame.onload = () => { if (request === exactGenerator.previewRequest) status.textContent = 'Showing ' + filePath + '. Use the page selector to view other exported pages.'; };
        frame.onerror = () => { if (request === exactGenerator.previewRequest) status.textContent = 'The preview could not load. Select the page again to retry.'; };
        frame.removeAttribute('src'); frame.srcdoc = '<!doctype html>\n' + previewDocument.documentElement.outerHTML; frame.hidden = false;
      } catch (error) { if (request === exactGenerator.previewRequest) status.textContent = 'Preview unavailable: ' + error.message; }
    }
    function findExactFile(node) {
      if (!node) return ''; if (node.type === 'file' && node.path.endsWith('.html')) return node.path;
      for (const child of node.children || []) { const found = findExactFile(child); if (found) return found; } return '';
    }
    function buildExactTree(node) {
      const wrap = document.createElement('div'); const label = document.createElement(node.type === 'file' ? 'button' : 'div');
      label.className = 'tree-node' + (node.type === 'directory' ? ' tree-dir' : ''); label.textContent = node.name + (node.type === 'directory' ? '/' : ''); wrap.appendChild(label);
      if (node.type === 'file') { label.type = 'button'; label.onclick = () => { document.querySelectorAll('#exactFileTree .tree-node').forEach(el => el.classList.remove('active')); label.classList.add('active'); selectExactFile(node.path); }; }
      else { const children = document.createElement('div'); children.style.paddingLeft = '10px'; for (const child of node.children || []) children.appendChild(buildExactTree(child)); wrap.appendChild(children); } return wrap;
    }
    async function selectExactFile(filePath) {
      const request = ++exactGenerator.fileRequest; document.getElementById('exactActiveFilePath').textContent = filePath; document.getElementById('exactFileContent').textContent = 'Loading...';
      try { const file = await exactRequest(exactConversionApi + '/' + encodeURIComponent(exactGenerator.conversionId) + '/files?path=' + encodeURIComponent(filePath)); if (request === exactGenerator.fileRequest) document.getElementById('exactFileContent').textContent = file.content; }
      catch (error) { if (request === exactGenerator.fileRequest) document.getElementById('exactFileContent').textContent = 'Preview unavailable (binary file or request error): ' + error.message; }
    }
    async function copyExactFileContent() {
      try { await navigator.clipboard.writeText(document.getElementById('exactFileContent').textContent); exactMessage('File content copied.'); }
      catch { exactMessage('Clipboard access failed. Select and copy the code manually.'); }
    }
    async function downloadExactZip() {
      if (!exactGenerator.conversionId) return; const button = document.getElementById('btnExactDownloadZip'); button.disabled = true;
      try {
        const response = await fetch(exactConversionApi + '/' + encodeURIComponent(exactGenerator.conversionId) + '/download', { headers: proxyHeaders });
        if (!response.ok) { const body = await response.json(); throw new Error(body.error?.message || 'Download failed'); }
        const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
        anchor.href = url; anchor.download = (exactGenerator.projectName || 'exact-project') + '.zip'; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch (error) { exactMessage('Download error: ' + error.message); } finally { button.disabled = false; }
    }
  `;
}
