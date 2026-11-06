import { Script, runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderPlaygroundHtml } from '../src/api/views/playground.html.js';

const html = renderPlaygroundHtml();
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
const stageIds = [
  'validate-input', 'load-scrape-snapshot', 'build-page-inventory', 'resolve-assets',
  'analyze-page-structure', 'identify-shared-components', 'generate-nextjs-files',
  'install-or-resolve-dependencies', 'run-static-validation', 'prepare-preview', 'package-project',
];

function harness() {
  const elements = new Map<string, any>();
  const makeElement = () => ({
    textContent: '', innerHTML: '', className: '', hidden: false, style: {}, children: [] as any[],
    attributes: {} as Record<string, string>, scrollHeight: 200, scrollTop: 100, clientHeight: 100,
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    appendChild(child: any) { this.children.push(child); },
    replaceChildren() { this.children = []; },
  });
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const copied: string[] = [];
  const context: any = {
    document: { getElementById: element, createElement: makeElement, createTextNode: (text: string) => ({ textContent: text }) },
    navigator: { clipboard: { writeText: async (text: string) => { copied.push(text); } } },
    setTimeout: () => 1,
    escapeHtml: (value: unknown) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  };
  runInNewContext(script.slice(script.indexOf('const operationPhases ='), script.indexOf('function renderProjectResults(record)')), context);
  const record = (status = 'IN_PROGRESS', completed = 3) => ({
    status, id: 'conv-1', currentStage: stageIds[completed] || stageIds[10],
    options: { projectName: 'example-nextjs', pages: ['https://example.com/', 'https://example.com/about'] },
    inventory: { targetUrl: 'https://example.com/', totalPages: 2 },
    createdAt: '2026-11-04T12:00:00Z', updatedAt: '2026-11-04T12:01:05Z',
    stages: stageIds.map((id, index) => ({
      id, label: id, status: index < completed ? 'completed' : index === completed ? 'running' : 'pending',
      startedAt: '2026-11-04T12:00:00Z', ...(index < completed ? { finishedAt: '2026-11-04T12:00:05Z' } : {}),
      message: index === completed ? 'Working on ' + id : 'Finished ' + id,
    })),
  });
  return { context, element, copied, record };
}

describe('live conversion operation view', () => {
  it('keeps all pipeline IDs and the genuine runtime iframe', () => {
    expect(() => new Script(script)).not.toThrow();
    expect(html).toContain('class="card live-operation"');
    expect(html).toContain('aria-label="Conversion phases"');
    for (const label of ['Discover', 'Capture', 'Generate', 'Package']) expect(html).toContain(label);
    expect(html).toContain('<details class="operation-details"><summary>Detailed pipeline · 11 stages</summary>');
    for (const id of ['nextjsProgressCard', 'nextjsStagesList', 'nextjsProgressPercent', 'nextjsProgressBar', 'nextjsResultCard', 'btnDownloadZip', 'sitePreviewFrame']) {
      expect(html).toContain('id="' + id + '"');
    }
    expect(html).toContain('sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" hidden');
    expect(html).not.toMatch(/sitePreviewFrame[^>]*srcdoc/);
    const polling = script.slice(script.indexOf('async function pollConversionProgress'), script.indexOf('const operationPhases ='));
    expect(polling).toContain('renderLiveOperation(record);');
    expect(html).not.toContain('>Validation: Passed</span>');
  });

  it('groups stages into four phases without inventing completion', () => {
    const h = harness();
    h.context.renderLiveOperation(h.record());
    const phases = h.element('nextjsOperationPhases').children;
    expect(phases).toHaveLength(4);
    expect(phases[0].className).toContain('is-done');
    expect(phases[1].className).toContain('is-active');
    expect(phases[1].attributes['aria-current']).toBe('step');
    expect(phases[2].className).not.toContain('is-done');
    expect(h.element('nextjsOperationProject').textContent).toBe('example-nextjs');
    expect(h.element('nextjsOperationUrl').textContent).toBe('https://example.com/');
    expect(h.element('nextjsOperationPages').textContent).toBe('2 pages');
    expect(h.element('nextjsProgressPercent').textContent).toBe('27%');
    expect(h.element('nextjsOperationProgress').attributes['aria-valuenow']).toBe('27');
    expect(h.element('nextjsStagesList').innerHTML.match(/class="stage-item /g)).toHaveLength(11);
    expect(h.element('nextjsOperationFinished').hidden).toBe(true);
  });

  it('shows real FAILED state, partial progress, error and frozen elapsed time', () => {
    const h = harness();
    const record = h.record('FAILED', 6);
    record.stages[6].status = 'failed';
    h.context.renderLiveOperation({ ...record, errorMessage: '<img onerror=alert(1)>' });
    expect(h.element('nextjsOperationStatus').textContent).toBe('Failed');
    expect(h.element('nextjsOperationPhases').children[2].className).toContain('is-failed');
    expect(h.element('nextjsProgressPercent').textContent).toBe('55%');
    expect(h.element('nextjsOperationProgress').className).toContain('is-failed');
    expect(h.element('nextjsOperationError').textContent).toBe('<img onerror=alert(1)>');
    expect(h.element('nextjsOperationError').hidden).toBe(false);
    expect(h.element('nextjsOperationElapsed').textContent).toBe('1m 05s');
    expect(h.element('nextjsOperationFinished').hidden).toBe(true);
  });

  it('renders and copies timestamped operationLogs as text with stage fallback', async () => {
    const h = harness();
    const record = h.record();
    const operationLogs = [
      { timestamp: '2026-11-04T12:00:00Z', stageId: 'validate-input', status: 'running', message: '<script>alert(1)</script>' },
      { timestamp: '2026-11-04T12:00:01Z', stageId: 'validate-input', status: 'completed', message: 'Input validated' },
    ];
    h.context.renderLiveOperation({ ...record, operationLogs });
    const expected = '2026-11-04T12:00:00.000Z [validate-input] running <script>alert(1)</script>\n2026-11-04T12:00:01.000Z [validate-input] completed Input validated';
    expect(h.element('nextjsOperationLogs').textContent).toBe(expected);
    expect(h.element('nextjsOperationLogs').innerHTML).toBe('');
    await h.context.copyOperationLogs();
    expect(h.copied).toEqual([expected]);
    expect(h.element('btnCopyOperationLogs').textContent).toBe('Copied');
    h.context.renderLiveOperation(record);
    expect(h.element('nextjsOperationLogs').textContent).toContain('[resolve-assets] running Working on resolve-assets');
    h.context.renderLiveOperation({ ...record, operationLogs: [] });
    expect(h.element('nextjsOperationLogs').textContent).toBe('No conversion events yet.');
  });

  it('does not report skipped phases as successes or invent progress when queued', () => {
    const h = harness();
    const record = h.record('IN_PROGRESS', 3);
    record.stages[1].status = 'skipped';
    h.context.renderLiveOperation(record);
    expect(h.element('nextjsOperationPhases').children[0].className).toContain('is-skipped');
    expect(h.element('nextjsOperationPhases').children[0].className).not.toContain('is-done');
    h.context.renderLiveOperation({ status: 'PENDING', stages: [] });
    expect(h.element('nextjsOperationStatus').textContent).toBe('Queued');
    expect(h.element('nextjsProgressPercent').textContent).toBe('0%');
    expect(h.element('nextjsOperationElapsed').textContent).toBe('—');
    expect(h.element('nextjsOperationFinished').hidden).toBe(true);
  });

  it('shows the finished download banner only for COMPLETED', () => {
    const h = harness();
    h.context.renderLiveOperation(h.record('COMPLETED', 11));
    expect(h.element('nextjsOperationStatus').textContent).toBe('Completed');
    expect(h.element('nextjsProgressPercent').textContent).toBe('100%');
    expect(h.element('nextjsOperationFinished').hidden).toBe(false);
    expect(h.element('nextjsOperationPhases').children.every((phase: any) => phase.className.includes('is-done'))).toBe(true);
    h.context.renderLiveOperation(h.record('FAILED', 11));
    expect(h.element('nextjsProgressPercent').textContent).toBe('99%');
    expect(h.element('nextjsOperationFinished').hidden).toBe(true);
  });

  it('preserves an unpinned log reader position and handles clipboard denial honestly', async () => {
    const h = harness();
    const logs = h.element('nextjsOperationLogs');
    logs.scrollTop = 0;
    h.context.renderLiveOperation(h.record());
    expect(logs.scrollTop).toBe(0);
    h.context.navigator.clipboard.writeText = async () => { throw new Error('Denied'); };
    await h.context.copyOperationLogs();
    expect(h.element('btnCopyOperationLogs').textContent).toBe('Copy unavailable');
  });
});
