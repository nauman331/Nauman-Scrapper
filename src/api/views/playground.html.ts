import { ENV } from '../../config/env.js';
import { DASHBOARD_ROUTES } from './dashboard-routes.js';
import { renderHtmlGeneratorWorkspace, renderHtmlGeneratorScript } from './html-generator.html.js';
import { renderExactCloneHtml, renderExactCloneScript } from './exact-clone.html.js';

export function renderPlaygroundHtml(): string {
  const defaultApiKey = ENV.API_KEY || 'dev-scrape-secret-key-2026';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Playground | Scrape Platform</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #141b2d;
      --card-inner: #0f1523;
      --sidebar-bg: #0e1322;
      --border: #232d42;
      --border-focus: #3b82f6;
      --primary: #2563eb;
      --primary-hover: #1d4ed8;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --green: #10b981;
      --cyan: #38bdf8;
      --code-bg: #070b14;
      --gutter-bg: #0b101c;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    .icon {
      width: 16px;
      height: 16px;
      flex: 0 0 auto;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .icon-sm { width: 14px; height: 14px; }
    .icon-lg { width: 18px; height: 18px; }
    .icon-only {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      min-height: 100vh;
      overflow-x: hidden;
    }
    /* Sidebar */
    .sidebar {
      width: 250px;
      background: var(--sidebar-bg);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }
    .brand {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--border);
      text-decoration: none;
      color: #fff;
    }
    .brand-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #2563eb, #7c3aed);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 16px;
    }
    .brand-title { font-size: 16px; font-weight: 700; }
    .nav { padding: 16px 10px; display: flex; flex-direction: column; gap: 4px; }
    .nav-label { font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; padding: 8px 12px; }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 8px;
      color: var(--text-muted);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .nav-link:hover { color: #fff; background: rgba(255,255,255,0.05); }
    .nav-link.active { color: #fff; background: rgba(37,99,235,0.15); border: 1px solid rgba(37,99,235,0.3); font-weight: 600; }

    /* Sidebar Application Widget */
    .sidebar-bottom {
      margin-top: auto;
      padding: 16px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .app-meta { font-size: 11px; color: var(--text-muted); }
    .app-meta strong { color: #fff; font-family: 'JetBrains Mono', monospace; }
    .btn-support {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 8px;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
      text-align: center;
    }
    .sys-date { font-size: 10px; color: #64748b; font-family: 'JetBrains Mono', monospace; }

    /* Main Container */
    .main { flex: 1; min-width: 0; display: flex; flex-direction: column; height: 100vh; overflow-y: auto; overflow-x: hidden; scrollbar-width: none; -ms-overflow-style: none; }
    .main::-webkit-scrollbar { display: none; }
    .topbar {
      height: 58px;
      border-bottom: 1px solid var(--border);
      background: var(--sidebar-bg);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 24px;
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .top-left { display: flex; align-items: center; gap: 16px; }
    .top-title { font-size: 16px; font-weight: 700; }

    /* Workspace */
    .workspace {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 20px;
      padding: 24px;
      max-width: 1600px;
      width: 100%;
      margin: 0 auto;
    }

    /* Cards */
    .left-col { min-width: 0; display: flex; flex-direction: column; gap: 18px; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 18px 20px;
    }
    .card-title { font-size: 13px; font-weight: 700; margin-bottom: 10px; text-transform: uppercase; color: var(--text-muted); letter-spacing: 0.5px; }

    /* URL Box */
    .url-box {
      display: flex;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }
    .url-method {
      background: rgba(37,99,235,0.15);
      color: #60a5fa;
      font-size: 12px;
      font-weight: 700;
      padding: 10px 14px;
      border-right: 1px solid var(--border);
      display: flex;
      align-items: center;
    }
    .url-input {
      flex: 1;
      background: transparent;
      border: none;
      padding: 10px 14px;
      color: #fff;
      font-family: 'JetBrains Mono', monospace;
      font-size: 13px;
      outline: none;
    }

    /* Code Snippet Box */
    .code-container {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      position: relative;
    }
    .code-pre {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #38bdf8;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .btn-copy-code {
      position: absolute;
      top: 10px;
      right: 10px;
      background: rgba(255,255,255,0.1);
      border: 1px solid var(--border);
      color: #fff;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
    }

    /* Response View - Scrape.do replica */
    .response-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .response-topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: rgba(255,255,255,0.02);
    }
    .resp-tabs { display: flex; gap: 4px; }
    .resp-tab {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-muted);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .resp-tab.active {
      background: rgba(255,255,255,0.06);
      border-color: var(--border);
      color: #fff;
    }
    .resp-actions { display: flex; align-items: center; gap: 10px; }
    .resp-icon-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      color: var(--text-muted);
      width: 28px;
      height: 28px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 0;
    }
    .resp-icon-btn:hover { color: #fff; border-color: #475569; }
    .badge-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 16px;
      font-size: 12px;
      font-weight: 700;
      background: rgba(59,130,246,0.12);
      border: 1px solid rgba(59,130,246,0.3);
      color: #60a5fa;
    }
    /* Editor View with Line Numbers */
    .editor-wrapper {
      display: flex;
      background: var(--code-bg);
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      min-height: 380px;
      max-height: 520px;
      overflow-y: auto;
    }
    .gutter {
      padding: 16px 12px;
      background: var(--gutter-bg);
      border-right: 1px solid var(--border);
      color: #475569;
      text-align: right;
      user-select: none;
      line-height: 20px;
      min-width: 44px;
    }
    .editor-content {
      flex: 1;
      padding: 16px;
      color: #cbd5e1;
      line-height: 20px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      min-width: 0;
      overflow: visible;
    }
    .response-footer {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 10px 16px;
      border-top: 1px solid var(--border);
      background: rgba(255,255,255,0.01);
    }
    .sidebar-history {
      padding: 14px 12px;
      border-top: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 9px;
    }
    .history-heading {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 0 2px;
      color: #64748b;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: .5px;
      text-transform: uppercase;
    }
    .history-select {
      width: 100%;
      min-width: 0;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 7px;
      color: var(--text);
      padding: 8px 9px;
      font-size: 11px;
      outline: none;
    }
    .history-select:focus { border-color: var(--border-focus); }
    .history-controls { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
    .history-btn {
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text-muted);
      padding: 7px 8px;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    }
    .history-btn:hover:not(:disabled) { color: #fff; border-color: #475569; background: rgba(255,255,255,0.08); }
    .history-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-report {
      background: transparent;
      border: none;
      color: var(--text-muted);
      font-size: 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .btn-report:hover { color: #fff; }

    /* Right Column Request Builder */
    .builder-col { display: flex; flex-direction: column; gap: 16px; }
    .form-group { margin-bottom: 16px; }
    .form-label { display: block; font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 8px; text-transform: uppercase; }
    .strategy-select {
      width: 100%;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px 12px;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      outline: none;
    }
    .strategy-select option { background: var(--card-bg); }
    .scope-options { display: grid; gap: 8px; }
    .scope-option { display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--card-inner); cursor: pointer; }
    .scope-option:focus-within { border-color: var(--border-focus); }
    .scope-option input { margin-top: 3px; accent-color: var(--primary); }
    .scope-copy { display: flex; flex-direction: column; gap: 2px; font-size: 13px; font-weight: 600; }
    .scope-copy small, .field-hint { color: var(--text-muted); font-size: 11px; font-weight: 400; line-height: 1.4; }
    .page-count-wrap { margin-top: 10px; }
    .specific-settings { display: grid; gap: 10px; margin-top: 10px; }
    .specific-keywords { width: 100%; min-height: 86px; resize: vertical; background: var(--card-inner); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: #fff; font: 13px/1.4 'JetBrains Mono', monospace; outline: none; }
    .specific-keywords:focus { border-color: var(--border-focus); }
    .page-count-input { width: 100%; background: var(--card-inner); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: #fff; font-size: 13px; outline: none; }
    .page-count-input:focus { border-color: var(--border-focus); }
    .toggle-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 8px;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 10px;
    }
    .toggle-item {
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 38px;
      padding: 7px 8px;
      border-radius: 7px;
      color: #e2e8f0;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .toggle-item:hover { background: rgba(255,255,255,0.045); }
    .toggle-label { display: inline-flex; align-items: center; gap: 7px; min-width: 0; }
    .option-info {
      width: 15px;
      height: 15px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
      border: 1.5px solid #64748b;
      border-radius: 50%;
      color: #94a3b8;
      font-family: Arial, sans-serif;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
    }
    .toggle-checkbox {
      appearance: none;
      -webkit-appearance: none;
      width: 36px;
      height: 20px;
      flex: 0 0 auto;
      position: relative;
      border: 1px solid #3b465b;
      border-radius: 999px;
      background: #293246;
      cursor: pointer;
      outline: none;
      transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
    }
    .toggle-checkbox::after {
      content: '';
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #f8fafc;
      box-shadow: 0 1px 3px rgba(0,0,0,0.35);
      transition: transform 0.18s ease;
    }
    .toggle-checkbox:checked { background: #3b82f6; border-color: #60a5fa; }
    .toggle-checkbox:checked::after { transform: translateX(16px); }
    .toggle-checkbox:focus-visible { box-shadow: 0 0 0 3px rgba(59,130,246,0.3); }
    .btn-submit {
      width: 100%;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 12px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(37,99,235,0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .btn-submit:hover:not(:disabled) { background: var(--primary-hover); }
    .btn-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-reset {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      background: rgba(255,255,255,0.05);
      border: 1px solid var(--border);
      color: var(--text-muted);
      border-radius: 8px;
      padding: 10px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
    }
    .btn-reset:hover { color: #fff; }
    .view-hidden { display: none !important; }
    .proxy-workspace {
      width: 100%;
      max-width: 1480px;
      margin: 0 auto;
      padding: 34px 36px 56px;
    }
    .proxy-page-intro { margin-bottom: 26px; }
    .proxy-page-title { font-size: 25px; line-height: 1.25; font-weight: 800; letter-spacing: -0.4px; }
    .proxy-page-copy { max-width: 720px; margin-top: 8px; color: var(--text-muted); font-size: 13px; line-height: 1.65; }
    .proxy-overview { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(280px, 0.75fr); gap: 20px; align-items: stretch; }
    .proxy-card { padding: 24px; }
    .proxy-section-heading { font-size: 15px; font-weight: 700; color: var(--text); }
    .proxy-section-copy { margin-top: 6px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
    .proxy-form { display: grid; grid-template-columns: minmax(180px, 0.8fr) minmax(320px, 1.7fr) 142px; gap: 14px; align-items: end; margin-top: 22px; }
    .proxy-field { min-width: 0; }
    .proxy-input { width: 100%; height: 46px; margin-top: 8px; padding: 0 13px; background: var(--card-inner); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-family: inherit; font-size: 13px; outline: none; transition: border-color .15s, box-shadow .15s; }
    .proxy-input::placeholder { color: #64748b; }
    .proxy-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px rgba(59,130,246,.14); }
    .proxy-add-btn { height: 46px; box-shadow: none; }
    .proxy-message { min-height: 20px; margin-top: 12px; color: var(--cyan); }
    .proxy-summary { display: flex; flex-direction: column; justify-content: space-between; background: linear-gradient(145deg, rgba(37,99,235,.13), rgba(20,27,45,.55)); }
    .proxy-summary-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 10px; color: #60a5fa; background: rgba(37,99,235,.16); border: 1px solid rgba(59,130,246,.28); }
    .proxy-stat { margin-top: 22px; }
    .proxy-stat-value { font-size: 30px; font-weight: 800; }
    .proxy-stat-label { margin-top: 3px; color: var(--text-muted); font-size: 12px; }
    .proxy-security-note { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--text-muted); font-size: 11px; line-height: 1.6; }
    .proxy-saved-card { margin-top: 20px; padding: 0; overflow: hidden; }
    .proxy-saved-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 21px 24px; border-bottom: 1px solid var(--border); }
    .proxy-count { padding: 5px 9px; border-radius: 999px; color: #93c5fd; background: rgba(37,99,235,.12); border: 1px solid rgba(59,130,246,.22); font-size: 11px; font-weight: 700; }
    .proxy-table-head { display: grid; grid-template-columns: minmax(130px, .8fr) minmax(230px, 1.55fr) 120px 100px 170px 150px; gap: 14px; padding: 10px 24px; background: rgba(255,255,255,.018); border-bottom: 1px solid var(--border); color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: .55px; text-transform: uppercase; }
    .proxy-list { display: flex; flex-direction: column; }
    .proxy-row { display: grid; grid-template-columns: minmax(130px, .8fr) minmax(230px, 1.55fr) 120px 100px 170px 150px; gap: 14px; align-items: center; min-height: 76px; padding: 14px 24px; border-bottom: 1px solid var(--border); font-size: 12px; }
    .proxy-row:last-child { border-bottom: 0; }
    .proxy-name { min-width: 0; font-size: 13px; font-weight: 700; }
    .proxy-url { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #cbd5e1; font-size: 11px; }
    .proxy-cell-label { display: none; color: #64748b; font-size: 9px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; }
    .proxy-status { display: inline-flex; width: fit-content; align-items: center; gap: 6px; padding: 5px 9px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .proxy-status::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .proxy-status-WORKING { color: #34d399; background: rgba(16,185,129,.1); }
    .proxy-status-NOT_WORKING { color: #fb7185; background: rgba(244,63,94,.1); }
    .proxy-status-UNTESTED { color: #94a3b8; background: rgba(148,163,184,.1); }
    .proxy-muted { color: var(--text-muted); line-height: 1.45; }
    .proxy-actions { display: flex; justify-content: flex-end; gap: 7px; }
    .proxy-btn { min-height: 34px; padding: 7px 11px; border: 1px solid var(--border); border-radius: 7px; background: rgba(255,255,255,.035); color: var(--text); font-size: 11px; font-weight: 600; cursor: pointer; transition: border-color .15s, background .15s; }
    .proxy-btn:hover { border-color: #475569; background: rgba(255,255,255,.075); }
    .proxy-btn-danger { color: #fda4af; }
    .proxy-empty { padding: 58px 24px; text-align: center; }
    .proxy-empty-icon { width: 48px; height: 48px; display: grid; place-items: center; margin: 0 auto 14px; border-radius: 12px; color: #60a5fa; background: rgba(37,99,235,.11); border: 1px solid rgba(59,130,246,.2); }
    .proxy-empty strong { display: block; font-size: 14px; }
    .proxy-empty p { max-width: 430px; margin: 7px auto 0; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
    @media (max-width: 1180px) {
      .proxy-overview { grid-template-columns: 1fr; }
      .proxy-summary { min-height: 180px; }
      .proxy-table-head { display: none; }
      .proxy-row { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) minmax(0, 1fr); }
      .proxy-address { grid-column: 1 / -1; }
      .proxy-actions { justify-content: flex-start; }
      .proxy-cell-label { display: block; margin-bottom: 5px; }
    }
    @media (max-width: 760px) {
      .proxy-workspace { padding: 24px 16px 40px; }
      .proxy-form { grid-template-columns: 1fr; }
      .proxy-add-btn { width: 100%; }
      .proxy-row { grid-template-columns: 1fr 1fr; padding: 18px; }
      .proxy-address, .proxy-name-wrap, .proxy-actions { grid-column: 1 / -1; }
      .proxy-saved-head { align-items: flex-start; padding: 18px; }
    }
    /* Next.js Project Generator Workspace */
    .nextjs-workspace {
      width: 100%;
      max-width: 1480px;
      margin: 0 auto;
      padding: 34px 36px 56px;
    }
    .nextjs-header { margin-bottom: 24px; }
    .nextjs-title { font-size: 25px; line-height: 1.25; font-weight: 800; letter-spacing: -0.4px; }
    .nextjs-copy { max-width: 780px; margin-top: 8px; color: var(--text-muted); font-size: 13px; line-height: 1.65; }
    
    .nextjs-grid {
      display: grid;
      grid-template-columns: minmax(320px, 1fr) minmax(380px, 1.25fr);
      gap: 20px;
      align-items: start;
    }
    .badge-nextjs {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.15);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #93c5fd;
      font-size: 11px;
      font-weight: 700;
    }
    .pages-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 14px;
      font-size: 12px;
    }
    .pages-table th {
      text-align: left;
      padding: 10px 12px;
      background: rgba(255, 255, 255, 0.03);
      color: #94a3b8;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border);
    }
    .pages-table td {
      padding: 10px 12px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      color: var(--text);
    }
    .pages-table tr:hover td {
      background: rgba(255, 255, 255, 0.02);
    }

    /* Pipeline Stage Timeline */
    .stages-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: 16px;
    }
    .stage-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: var(--card-inner);
      border: 1px solid var(--border);
      border-radius: 8px;
      transition: all 0.2s ease;
    }
    .stage-item.stage-running {
      border-color: #3b82f6;
      background: rgba(37, 99, 235, 0.08);
      box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
    }
    .stage-item.stage-completed {
      border-color: rgba(16, 185, 129, 0.3);
      background: rgba(16, 185, 129, 0.04);
    }
    .stage-item.stage-failed {
      border-color: rgba(239, 68, 68, 0.4);
      background: rgba(239, 68, 68, 0.08);
    }
    .stage-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .stage-icon {
      width: 22px;
      height: 22px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 700;
    }
    .stage-pending .stage-icon { background: rgba(255, 255, 255, 0.05); color: #64748b; }
    .stage-running .stage-icon { background: rgba(37, 99, 235, 0.3); color: #60a5fa; animation: pulse 1.5s infinite; }
    .stage-completed .stage-icon { background: rgba(16, 185, 129, 0.2); color: #34d399; }
    .stage-failed .stage-icon { background: rgba(239, 68, 68, 0.2); color: #f87171; }

    .project-explorer-header { display:flex;align-items:center;gap:12px;padding:14px 16px;margin-top:20px;background:var(--card-bg);border:1px solid var(--border);border-radius:14px 14px 0 0; }
    .project-explorer-header span { color:var(--text-muted);font-size:12px; }
    .project-explorer-header button { margin-left:auto; }
    .explorer-search { width:100%;padding:10px;margin:0 0 12px;border:1px solid var(--border);border-radius:8px;background:var(--card-inner);color:#e2ebe5; }
    .explorer-open-tabs { display:flex;flex-shrink:0;overflow-x:auto;background:var(--card-inner);border-bottom:1px solid var(--border); }
    .explorer-open-tabs button { background:transparent;color:#9eb2a5;border:0;border-right:1px solid var(--border);padding:12px;white-space:nowrap;cursor:pointer; }
    .explorer-open-tabs button.active { color:var(--border-focus);background:var(--card-inner); }
    .explorer-editor { display:flex;flex:1;min-height:0;overflow:auto;background:var(--code-bg); }
    .explorer-line-numbers { margin:0;padding:16px 10px 16px 16px;color:#6c8776;font:12px/1.7 'JetBrains Mono',monospace;text-align:right;user-select:none; }
    .explorer-editor .file-code-view { margin:0;overflow:visible;line-height:1.7; }
    .explorer-statusbar { display:flex;justify-content:space-between;gap:12px;padding:6px 12px;background:var(--primary);color:#e9fff2;font-size:11px;flex-shrink:0; }
    #explorerStatusPath { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .project-explorer-header + .explorer-grid { margin-top:0;border-radius:0 0 14px 14px;border-color:var(--border);height:580px;grid-template-columns:250px minmax(0,1fr); }
    .project-explorer-header + .explorer-grid .file-tree-pane { background:var(--card-bg); }
    .project-explorer-header + .explorer-grid .file-content-pane { background:var(--code-bg);min-width:0; }
    .project-explorer-header + .explorer-grid .tree-node.active { background:var(--card-inner);color:var(--border-focus); }
    @media(max-width:760px) { .project-explorer-header + .explorer-grid { grid-template-columns:minmax(0,1fr);height:auto; } .explorer-editor { min-height:360px;max-height:520px; } }
    .explorer-tree-icon { width:15px;height:15px;flex-shrink:0; }
    .explorer-folder-row, .explorer-file-row { width:100%;border:0;background:transparent;text-align:left;font:inherit; }
    .explorer-folder-row > .explorer-tree-icon:first-child { width:12px;transform:rotate(90deg);transition:transform .15s; }
    .explorer-folder-row[aria-expanded="false"] > .explorer-tree-icon:first-child { transform:rotate(0); }
    .explorer-folder-row span, .explorer-file-row span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .explorer-tree-children[hidden] { display:none; }
    /* Dashboard theme tokens take precedence over reference-only accents. */
    .explorer-open-tabs { background:var(--card-inner); }
    .explorer-search, .explorer-open-tabs button { color:var(--text-muted); }
    .explorer-open-tabs button.active { color:var(--border-focus);background:var(--card-bg); }
    .explorer-line-numbers { color:var(--text-muted); }
    .explorer-statusbar { color:var(--text); }
    .project-explorer-header + .explorer-grid .tree-node.active { background:rgba(37,99,235,.2);color:var(--border-focus); }
    .operation-heading p, .operation-status, .operation-phase, .operation-phase.is-skipped,
    .operation-console-head, .operation-console-head button, .operation-logs { color:var(--text-muted); }
    .operation-meta > strong { color:var(--text); }
    .operation-progress { background:var(--border); }
    .live-operation .stage-running .stage-icon { background:var(--card-inner);color:var(--border-focus); }
    .site-preview-toolbar { background:var(--card-bg); }
    .site-preview-panel select { color:var(--text); }
    .btn-download-hero { background:var(--primary);box-shadow:none; }
    .btn-download-hero:hover { background:var(--primary-hover);box-shadow:none; }
    /* File Explorer & Code Viewer */
    .explorer-grid {
      display: grid;
      grid-template-columns: 290px 1fr;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      background: var(--card-inner);
      min-height: 520px;
      margin-top: 16px;
    }
    .file-tree-pane {
      background: #080d1a;
      border-right: 1px solid var(--border);
      padding: 14px 10px;
      overflow-y: auto;
      max-height: 600px;
    }
    .file-tree-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #64748b;
      padding: 4px 10px 10px;
      letter-spacing: 0.5px;
    }
    .tree-node {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 12px;
      color: #cbd5e1;
      cursor: pointer;
      font-family: 'JetBrains Mono', monospace;
      transition: background 0.15s;
    }
    .tree-node:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #fff;
    }
    .tree-node.active {
      background: rgba(37, 99, 235, 0.2);
      color: #60a5fa;
      font-weight: 600;
    }
    .tree-dir {
      font-weight: 600;
      color: #94a3b8;
    }
    .file-content-pane {
      display: flex;
      flex-direction: column;
      background: #060911;
      min-width: 0;
    }
    .file-content-header {
      display: flex;
      align-items: center;
      padding: 12px 18px;
      border-bottom: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.015);
    }
    .file-path-badge {
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      color: #38bdf8;
    }
    .file-code-view {
      flex: 1;
      padding: 16px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 12px;
      line-height: 1.6;
      color: #e2e8f0;
      white-space: pre;
      overflow: auto;
      max-height: 520px;
    }

    .btn-download-hero {
      background: var(--primary);
      color: #fff;
      border: none;
      padding: 14px 24px;
      border-radius: 10px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 10px;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      transition: all 0.2s;
    }
    .btn-download-hero:hover {
      background: var(--primary-hover);
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(16, 185, 129, 0.45);
    }
    /* Compact live operation with real pipeline state. */
    .live-operation, #nextjsResultCard { background:var(--card-bg); border-color:var(--border); border-radius:16px; }
    .operation-head { display:flex;align-items:center;gap:12px;padding-bottom:20px;border-bottom:1px solid var(--border); }
    .operation-step { display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:var(--card-inner);color:var(--border-focus);font-size:12px;font-weight:700;flex-shrink:0; }
    .operation-heading { min-width:0;flex:1; }
    .operation-heading h2 { font-size:15px; }
    .operation-heading p { color:var(--text-muted);font-size:12px;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .operation-status { padding:5px 9px;border:1px solid var(--border);border-radius:999px;font-size:11px;color:#a6baad;white-space:nowrap; }
    .operation-status::before { content:'';display:inline-block;width:6px;height:6px;background:currentColor;border-radius:50%;margin-right:6px; }
    .operation-status.is-active, .operation-status.is-done { color:var(--border-focus);background:var(--card-inner); }
    .operation-status.is-failed { color:#fda4af;background:#351d25;border-color:#68353f; }
    .operation-phases { display:grid;grid-template-columns:repeat(4,minmax(0,1fr));list-style:none;gap:12px;margin:20px 0; }
    .operation-phase { display:flex;align-items:center;gap:8px;font-size:12px;color:#849b8d; }
    .operation-phase span { width:24px;height:24px;display:grid;place-items:center;border:1px solid var(--border);border-radius:50%;font-size:11px;flex-shrink:0; }
    .operation-phase.is-active { color:var(--text); }
    .operation-phase.is-active span { border-color:var(--border-focus);background:var(--card-inner); }
    .operation-phase.is-done { color:var(--border-focus); }
    .operation-phase.is-done span { background:var(--card-inner);border-color:var(--border-focus); }
    .operation-phase.is-failed { color:#fda4af; }
    .operation-phase.is-skipped { color:#a6baad; }
    .operation-summary { display:flex;justify-content:space-between;gap:16px;margin:18px 0 12px; }
    .operation-task { display:flex;flex-direction:column;gap:6px;min-width:0; }
    .operation-task small { color:var(--text-muted);font-size:10px;text-transform:uppercase;letter-spacing:1px; }
    .operation-task strong { font-size:13px;overflow-wrap:anywhere; }
    .operation-task > span { color:var(--text-muted);font-size:11px;overflow-wrap:anywhere; }
    .operation-meta { text-align:right;flex-shrink:0; }
    .operation-meta > strong { display:block;font-size:24px;letter-spacing:-1px;color:var(--text); }
    .operation-meta small { display:block;color:var(--text-muted);font-size:11px;margin-top:6px; }
    .operation-progress { height:5px;background:#27392e;border-radius:999px;overflow:hidden; }
    #nextjsProgressBar { height:100%;background:var(--primary);transition:width .3s ease; }
    .operation-progress.is-failed #nextjsProgressBar { background:#ef7186; }
    .operation-console { margin-top:20px;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--code-bg); }
    .operation-console-head { display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);color:#a6baad;font:11px 'JetBrains Mono',monospace; }
    .operation-console-head button { background:transparent;border:0;color:var(--text-muted);font:inherit;cursor:pointer;padding:4px; }
    .operation-logs { min-height:130px;max-height:240px;overflow:auto;padding:14px;color:var(--text-muted);font:11px/1.8 'JetBrains Mono',monospace;white-space:pre-wrap;overflow-wrap:anywhere; }
    .operation-error { color:#fda4af;padding:14px 0;font-size:12px;overflow-wrap:anywhere; }
    .operation-finished { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px;padding:12px;background:var(--card-inner);border:1px solid var(--border-focus);border-radius:10px;color:var(--text);font-size:12px; }
    .operation-finished[hidden] { display:none; }
    .operation-details { margin-top:18px;border-top:1px solid var(--border);padding-top:14px; }
    .operation-details summary { cursor:pointer;color:var(--text-muted);font-size:12px; }
    .live-operation .stage-running { border-color:var(--border-focus);background:var(--card-inner);box-shadow:none; }
    .live-operation .stage-running .stage-icon { background:#2d513c;color:var(--border-focus); }
    .live-operation button:focus-visible, .live-operation summary:focus-visible, .operation-logs:focus-visible { outline:2px solid var(--border-focus);outline-offset:3px; }
    @media (max-width: 760px) { .operation-phases { gap:8px; } .operation-phase { flex-direction:column;align-items:flex-start;font-size:11px; } .operation-summary { flex-wrap:wrap; } .operation-meta { text-align:left; } .operation-finished { flex-wrap:wrap; } }
    @media (prefers-reduced-motion: reduce) { #nextjsProgressBar { transition:none; } .live-operation .stage-running .stage-icon { animation:none; } }
    /* Real, isolated Next.js runtime preview (never a raw HTML snapshot). */
    .site-preview-panel { margin-top: 18px; border: 1px solid var(--border); border-radius: 14px; overflow: hidden; background: var(--card-inner); }
    .site-preview-toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 14px; border-bottom: 1px solid var(--border); background:var(--card-bg); }
    .site-preview-panel .history-btn, .operation-finished .history-btn { border-color:var(--border-focus);background:var(--card-inner);color:var(--text); }
    .site-preview-panel select { border-color:var(--border);background:var(--card-inner);color:#dcebe1; }
    .site-preview-panel .badge-status { border:1px solid var(--border);background:var(--card-inner);color:var(--text); }
    .site-preview-panel .site-preview-note, .site-preview-panel .site-preview-logs summary { color:var(--text-muted); }
    .site-preview-title { font-size: 13px; margin-right: auto; }
    .site-preview-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .site-preview-controls select { width: auto; max-width: 260px; min-width: 120px; }
    .site-preview-note { padding: 10px 14px; color: var(--text-muted); font-size: 12px; line-height: 1.6; }
    .site-preview-error { padding: 0 14px 10px; color: #fda4af; font-size: 12px; overflow-wrap: anywhere; }
    .site-preview-viewport { display: flex; justify-content: center; min-height: 360px; background: var(--code-bg); }
    .site-preview-frame { display: block; width: 100%; height: 560px; border: 0; background: #fff; }
    .site-preview-frame[hidden] { display: none; }
    .site-preview-logs { padding: 12px 14px; border-top: 1px solid var(--border); }
    .site-preview-logs summary { cursor: pointer; color: var(--text-muted); font-size: 12px; }
    .site-preview-logs pre { margin-top: 10px; max-height: 180px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.6 'JetBrains Mono', monospace; }
    @media (max-width: 760px) {
      .nextjs-workspace { padding: 24px 16px 40px; }
      .explorer-grid { grid-template-columns: minmax(0, 1fr); }
      .file-tree-pane { max-height: 200px; border-right: 0; border-bottom: 1px solid var(--border); }
      .site-preview-controls { width: 100%; }
      .site-preview-controls select { max-width: 100%; flex: 1; }
    }
    .options-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
      margin-top: 14px;
    }
  </style>
</head>
<body>
  <svg width="0" height="0" aria-hidden="true" style="position:absolute;overflow:hidden">
    <defs>
      <symbol id="icon-bolt" viewBox="0 0 24 24"><path d="M13 2 4.5 13H11l-1 9 8.5-11H12l1-9Z"/></symbol>
      <symbol id="icon-terminal" viewBox="0 0 24 24"><path d="m5 7 4 4-4 4M11 17h8"/></symbol>
      <symbol id="icon-book" viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M8 7h8M8 11h6"/></symbol>
      <symbol id="icon-heart-pulse" viewBox="0 0 24 24"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 12 5a5.5 5.5 0 0 0-10 3.5C2 14 12 21 12 21s2.1-1.5 4.4-3.6"/><path d="M3 12h5l2-4 4 8 2-4h5"/></symbol>
      <symbol id="icon-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></symbol>
      <symbol id="icon-copy" viewBox="0 0 24 24"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></symbol>
      <symbol id="icon-message" viewBox="0 0 24 24"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M8 9h8M8 13h5"/></symbol>
      <symbol id="icon-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></symbol>
      <symbol id="icon-download" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"/></symbol>
      <symbol id="icon-play" viewBox="0 0 24 24"><path d="m8 5 11 7-11 7V5Z"/></symbol>
      <symbol id="icon-rotate" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></symbol>
      <symbol id="icon-external" viewBox="0 0 24 24"><path d="M15 4h5v5M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></symbol>
      <symbol id="icon-code" viewBox="0 0 24 24"><path d="m8 9-4 3 4 3M16 9l4 3-4 3M14 5l-4 14"/></symbol>
      <symbol id="icon-history" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></symbol>
    </defs>
  </svg>
  <!-- Sidebar -->
  <aside class="sidebar">
    <a href="/" class="brand">
      <div class="brand-icon"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-bolt"></use></svg></div>
      <div class="brand-title">Scraper Platform</div>
    </a>
    <div class="nav">
      <div class="nav-label">Dashboard</div>
      <a href="${DASHBOARD_ROUTES.playground}" id="playgroundNav" class="nav-link active" onclick="showView('playground');return false"><svg class="icon" aria-hidden="true"><use href="#icon-terminal"></use></svg> Playground</a>
      <a href="${DASHBOARD_ROUTES.nextjs}" id="nextjsNav" class="nav-link" onclick="showView('nextjs');return false"><svg class="icon" aria-hidden="true"><use href="#icon-code"></use></svg> Next.js Generator</a>
      <a href="${DASHBOARD_ROUTES.html}" id="htmlNav" class="nav-link" onclick="showView('html');return false"><svg class="icon" aria-hidden="true"><use href="#icon-code"></use></svg> HTML generator</a>
      <a href="${DASHBOARD_ROUTES.exact}" id="exactNav" class="nav-link" onclick="showView('exact');return false"><svg class="icon" aria-hidden="true"><use href="#icon-code"></use></svg> Exact clone</a>
      <a href="${DASHBOARD_ROUTES.proxies}" id="proxiesNav" class="nav-link" onclick="showView('proxies');return false"><svg class="icon"><use href="#icon-terminal"></use></svg> Proxies</a>
      <a href="/docs" class="nav-link"><svg class="icon" aria-hidden="true"><use href="#icon-book"></use></svg> Documentation</a>
      <div class="nav-label">Monitoring</div>
      <a href="/health" target="_blank" class="nav-link"><svg class="icon" aria-hidden="true"><use href="#icon-heart-pulse"></use></svg> /health</a>
      <a href="/ready" target="_blank" class="nav-link"><svg class="icon" aria-hidden="true"><use href="#icon-check-circle"></use></svg> /ready</a>
    </div>

    <section class="sidebar-history" aria-labelledby="historyHeading">
      <div class="history-heading" id="historyHeading">
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-history"></use></svg>
        Recent runs
      </div>
      <select id="historySelect" class="history-select" aria-label="Saved scrape history" onchange="updateHistoryButtons()">
        <option value="">No saved runs yet</option>
      </select>
      <div class="history-controls">
        <button id="loadHistoryBtn" class="history-btn" onclick="loadHistoryRun()" disabled>Load run</button>
        <button id="deleteHistoryBtn" class="history-btn" onclick="deleteHistoryRun()" disabled>Delete</button>
      </div>
    </section>

    <!-- Application / User details matching screenshot -->
    <div class="sidebar-bottom">

      <div class="app-meta">
        <div>Your Email:</div>
        <strong style="font-size:12px;">waqarlogicmox@gmail.com</strong>
      </div>

      <div class="app-meta">
        <div>Your API Token:</div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:2px;">
          <strong id="sidebarToken">${defaultApiKey.slice(0, 5)}********************</strong>
          <button class="icon-only" style="background:none; border:none; color:#60a5fa; cursor:pointer;" title="Copy API token" aria-label="Copy API token" onclick="navigator.clipboard.writeText('${defaultApiKey}')"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-copy"></use></svg></button>
        </div>
      </div>

      <button class="btn-support"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-message"></use></svg> Contact Support</button>
      <div class="sys-date">System Date: 23.10.2026</div>
    </div>
  </aside>

  <!-- Main View -->
  <div class="main">
    <header class="topbar">
      <div class="top-left">
        <span class="top-title">Playground</span>
      </div>
      <div>
        <a href="/docs" style="color:var(--text-muted); font-size:13px; text-decoration:none; font-weight:600; display:flex; align-items:center; gap:6px;">Documentation <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-external"></use></svg></a>
      </div>
    </header>

    <div class="workspace" id="playgroundView">
      <!-- Left Column -->
      <div class="left-col">
        <!-- Target URL Box -->
        <div class="card">
          <div class="card-title">URL to Scrape</div>
          <div class="url-box">
            <span class="url-method">GET</span>
            <input type="url" id="targetUrl" class="url-input" placeholder="https://example.com" required oninput="updateCodeSnippet()">
          </div>
        </div>

        <!-- Dynamic Code Sample -->
        <div class="card">
          <div class="card-title" style="display:flex;align-items:center;gap:7px;"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-code"></use></svg> Code Sample</div>
          <div class="code-container">
            <button class="btn-copy-code" onclick="navigator.clipboard.writeText(document.getElementById('codeSnippet').innerText); alert('Copied to clipboard!')"><svg class="icon icon-sm" aria-hidden="true" style="vertical-align:-2px;margin-right:5px;"><use href="#icon-copy"></use></svg>Copy</button>
            <pre class="code-pre" id="codeSnippet"></pre>
          </div>
        </div>

        <section id="scrapeOperationCard" class="card live-operation" style="display:none;margin-bottom:14px;" aria-label="Live scraping operation">
          <div style="display:flex;justify-content:space-between;align-items:center;"><strong>Live scraping operation</strong><span id="scrapeOperationStatus" class="badge-status" role="status" aria-live="polite">Preparing</span></div>
          <p id="scrapeOperationUrl" style="margin:10px 0;overflow-wrap:anywhere;"></p>
          <div id="scrapeOperationSteps" style="display:flex;justify-content:space-between;gap:8px;margin:18px 0;"></div>
          <p id="scrapeOperationSummary"></p>
          <progress id="scrapeOperationProgress" style="width:100%;height:8px;" aria-label="Scrape page budget progress"></progress>
          <p style="font-size:11px;color:var(--text-muted);">Page limit is a maximum, not a guaranteed total. A crawl can finish early when no eligible links remain.</p>
          <details open><summary>scrape.log</summary><pre id="scrapeOperationLogs" style="max-height:180px;overflow:auto;white-space:pre-wrap;font-size:11px;line-height:1.7;"></pre></details>
        </section>

        <!-- Response Panel (Scrape.do replica) -->
        <div class="response-card">
          <div class="response-topbar">
            <div class="resp-tabs">
              <button class="resp-tab active" id="tabResponse" onclick="setResponseView('html')">Response</button>
              <button class="resp-tab" id="tabExtracted" onclick="setResponseView('json')">Extracted Data</button>
              <button class="resp-tab" id="tabCleanData" onclick="setResponseView('clean')">Clean Data</button>
              <button class="resp-tab" id="tabHeaders" onclick="setResponseView('headers')">Headers</button>
              <button class="resp-tab" id="tabScrapePreview" onclick="setResponseView('preview')">Preview</button>
            </div>
            <div class="resp-actions">
              <button class="resp-icon-btn" title="Convert scraped website to Next.js project" id="btnNextjsAction" style="color:#60a5fa;border-color:rgba(59,130,246,0.4);background:rgba(37,99,235,0.15);gap:5px;padding:0 8px;" onclick="launchNextjsFromPlayground()"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-code"></use></svg> <span style="font-size:11px;font-weight:600;">Next.js</span></button>
              <button class="resp-icon-btn" title="Search response" aria-label="Search response" onclick="promptSearch()"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-search"></use></svg></button>
              <button class="resp-icon-btn" title="Download response" aria-label="Download response" onclick="downloadResponse()"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-download"></use></svg></button>
              <button class="resp-icon-btn" title="Copy response" aria-label="Copy response" onclick="copyResponse()"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-copy"></use></svg></button>
              <span class="badge-status" id="respStatus">Status: Ready</span>
            </div>
          </div>

          <!-- Line Numbered Code Viewer -->
          <div class="editor-wrapper" id="editorWrap">
            <div class="gutter" id="lineGutter">1\\n2\\n3\\n4\\n5</div>
            <pre class="editor-content" id="editorContent">&lt;!-- Click 'Try it' to execute crawl and view response with line numbers --&gt;
&lt;!DOCTYPE html&gt;
&lt;html lang="en"&gt;
&lt;head&gt;
  &lt;meta charset="utf-8" /&gt;
  &lt;title&gt;Playground Response&lt;/title&gt;
&lt;/head&gt;
&lt;body&gt;
  &lt;h1&gt;Ready to scrape&lt;/h1&gt;
&lt;/body&gt;
&lt;/html&gt;</pre>
          </div>

          <div id="scrapePreviewPane" style="display:none;min-height:360px;">
            <p style="padding:8px 12px;color:var(--text-muted);font-size:11px;">Captured HTML preview. Scripts and forms are disabled; external assets load from the source website. This is not the generated Next.js build.</p>
            <iframe id="scrapePreviewFrame" title="Scraped website preview" sandbox="" referrerpolicy="no-referrer" style="display:block;width:100%;height:520px;border:0;background:white;"></iframe>
          </div>

          <div class="response-footer">
            <button class="btn-report"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-message"></use></svg> Report an Issue</button>
          </div>
        </div>
      </div>

      <!-- Right Column: Request Builder -->
      <div class="builder-col">
        <div class="card">
          <div class="card-title">Build Your Request</div>

          <div class="form-group">
            <label class="form-label">Crawler Engine</label>
            <select id="strategy" class="strategy-select" onchange="handleStrategyChange()">
              <option value="AUTO">AUTO (SPA Detection)</option>
              <option value="CHEERIO">CHEERIO (Fast Static HTML)</option>
              <option value="PLAYWRIGHT">PLAYWRIGHT (Chromium Browser)</option>
            </select>
          </div>

          <fieldset class="form-group" style="border:0;">
            <legend class="form-label">Crawl Scope</legend>
            <div class="scope-options">
              <label class="scope-option"><input type="radio" name="crawlScope" value="landing" checked onchange="handleScopeChange()"><span class="scope-copy">Landing page<small>Only scrape the URL entered above.</small></span></label>
              <label class="scope-option"><input type="radio" name="crawlScope" value="count" onchange="handleScopeChange()"><span class="scope-copy">Number of pages<small>Crawl a specific number of internal pages.</small></span></label>
              <label class="scope-option"><input type="radio" name="crawlScope" value="full" onchange="handleScopeChange()"><span class="scope-copy">Full website<small>Crawl internal links, up to 500 pages.</small></span></label>
              <label class="scope-option"><input type="radio" name="crawlScope" value="specific" onchange="handleScopeChange()"><span class="scope-copy">Specific pages<small>Always crawl the landing page, then matching internal links only.</small></span></label>
            </div>
            <div id="pageCountWrap" class="page-count-wrap" hidden>
              <label class="form-label" for="pageCount">Number of pages</label>
              <input id="pageCount" class="page-count-input" type="number" min="1" max="500" step="1" value="10" inputmode="numeric" oninput="handlePageCountChange()" aria-describedby="pageCountHint">
              <div class="field-hint" id="pageCountHint">Enter a value from 1 to 500.</div>
            </div>
            <div id="specificSettings" class="specific-settings" hidden>
              <div><label class="form-label" for="specificPageKeywords">Literal phrases</label><textarea id="specificPageKeywords" class="specific-keywords" rows="3" aria-describedby="specificKeywordsHint" onfocus="handleSpecificSettingsChange()" oninput="handleSpecificSettingsChange()">about us
contact us</textarea><div class="field-hint" id="specificKeywordsHint">One normalized literal phrase per line (not raw regex). For example, <code>about us</code> matches <code>/about-us</code> or anchor text “About Us”. A slash by itself is invalid because the landing page is already included. Enter 1–20 phrases, 2–64 normalized characters each, 512 total.</div></div>
              <div><label class="form-label" for="specificMaxPages">Maximum pages</label><input id="specificMaxPages" class="page-count-input" type="number" min="2" max="500" step="1" value="20" inputmode="numeric" aria-describedby="specificMaxPagesHint" onfocus="handleSpecificSettingsChange()" oninput="handleSpecificSettingsChange()"><div class="field-hint" id="specificMaxPagesHint">Enter a value from 2 to 500. The landing page counts toward this limit.</div></div>
            </div>
          </fieldset>

          <div class="form-group">
            <label class="form-label">Render Options</label>
            <div class="toggle-group">
              <label class="toggle-item" title="Use a browser engine to execute JavaScript before collecting the page.">
                <input type="checkbox" id="renderJs" class="toggle-checkbox" onchange="handleJsToggle()">
                <span class="toggle-label"><span class="option-info" aria-hidden="true">i</span>Render JavaScript</span>
              </label>
              <label class="toggle-item" title="Reuse the same proxy session across related requests.">
                <input type="checkbox" id="stickySession" class="toggle-checkbox" checked>
                <span class="toggle-label"><span class="option-info" aria-hidden="true">i</span>Sticky Session</span>
              </label>
            </div>
          </div>

          <div class="form-group"><label class="form-label">Proxy</label><div class="toggle-group"><label class="toggle-item"><input type="checkbox" id="enableProxy" class="toggle-checkbox" onchange="handleProxyToggle()"><span class="toggle-label">Enable saved proxy</span></label></div><select id="proxySelect" class="strategy-select" disabled onchange="updateCodeSnippet()"><option value="">Select a proxy</option></select></div>

          <div class="form-group">
            <label class="form-label">Advanced Options</label>
            <div class="toggle-group">
              <label class="toggle-item" title="Return the upstream response with minimal transformation.">
                <input type="checkbox" id="transparentResp" class="toggle-checkbox" checked>
                <span class="toggle-label"><span class="option-info" aria-hidden="true">i</span>Transparent Response</span>
              </label>
              <label class="toggle-item" title="Switch between HTML and structured JSON output.">
                <input type="checkbox" id="outputFormat" class="toggle-checkbox" checked onchange="toggleOutputFormat()">
                <span class="toggle-label"><span class="option-info" aria-hidden="true">i</span>Output Format: HTML</span>
              </label>
            </div>
          </div>

          <button id="btnTryIt" class="btn-submit" onclick="executeScrape()">
            <svg class="icon" aria-hidden="true"><use href="#icon-play"></use></svg> <span id="btnText">Try it</span>
          </button>
          <button class="btn-reset" onclick="resetDefaults()"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-rotate"></use></svg> Reset</button>
        </div>
      </div>
    </div>

    <section class="proxy-workspace view-hidden" id="proxiesView" aria-labelledby="proxyPageTitle">
      <div class="proxy-page-intro">
        <h1 class="proxy-page-title" id="proxyPageTitle">Proxy management</h1>
        <p class="proxy-page-copy">Add and monitor the proxy servers available to your scraping jobs. Test connectivity before assigning a proxy from the request builder.</p>
      </div>

      <div class="proxy-overview">
        <div class="card proxy-card">
          <div class="proxy-section-heading">Add a proxy</div>
          <p class="proxy-section-copy">Save an HTTP, HTTPS, SOCKS4, or SOCKS5 endpoint. A friendly name makes it easier to select later.</p>
          <form id="proxyForm" class="proxy-form" onsubmit="addProxy(event)">
            <div class="proxy-field">
              <label class="form-label" for="proxyName">Name <span style="color:#64748b;font-weight:500;">(optional)</span></label>
              <input id="proxyName" class="proxy-input" placeholder="Automatic: Proxy 1, Proxy 2, ..." autocomplete="off">
            </div>
            <div class="proxy-field">
              <label class="form-label" for="proxyUrl">Proxy URL</label>
              <input id="proxyUrl" class="proxy-input" type="text" required placeholder="host:port:username:password or http://user:password@host:port" autocomplete="off" spellcheck="false" aria-describedby="proxyMessage">
            </div>
            <button id="btnAddProxy" type="submit" class="btn-submit proxy-add-btn">Add proxy</button>
          </form>
          <div id="proxyMessage" class="field-hint proxy-message" role="status" aria-live="polite"></div>
        </div>

        <aside class="card proxy-card proxy-summary">
          <div>
            <div class="proxy-summary-icon"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-heart-pulse"></use></svg></div>
            <div class="proxy-stat"><div class="proxy-stat-value" id="proxyTotalCount">0</div><div class="proxy-stat-label">Saved proxies</div></div>
          </div>
          <div class="proxy-security-note">Credentials stay server-side. The dashboard and API only display masked proxy URLs.</div>
        </aside>
      </div>

      <div class="card proxy-card" style="margin-bottom:20px;">
        <h2 class="proxy-section-heading">Bulk proxy import</h2>
        <p id="bulkProxyHint" class="proxy-section-copy">Paste one proxy per line: host:port:username:password. Full proxy URLs are also accepted. Entries receive sequential names automatically; already saved duplicates are skipped. Maximum 500 proxies.</p>
        <form id="bulkProxyForm" onsubmit="importBulkProxies(event)">
          <label class="form-label" for="bulkProxyText">Proxy list</label>
          <textarea id="bulkProxyText" class="proxy-input" rows="8" required autocomplete="off" spellcheck="false" aria-describedby="bulkProxyHint bulkProxyMessage" placeholder="host:port:username:password" style="width:100%;box-sizing:border-box;resize:vertical;font-family:monospace;"></textarea>
          <button id="btnImportProxies" type="submit" class="btn-submit" style="margin-top:12px;">Import and save proxies</button>
        </form>
        <p id="bulkProxyMessage" class="field-hint" role="status" aria-live="polite"></p>
      </div>

      <div class="card proxy-saved-card">
        <div class="proxy-saved-head">
          <div><div class="proxy-section-heading">Saved proxies</div><p class="proxy-section-copy">Review health, latency, and the latest connection test.</p></div>
          <span class="proxy-count" id="proxyCountBadge">0 proxies</span>
        </div>
        <div class="proxy-table-head" aria-hidden="true"><span>Name</span><span>Proxy address</span><span>Status</span><span>Latency</span><span>Last tested</span><span style="text-align:right;">Actions</span></div>
        <div class="proxy-list" id="proxyList"></div>
      </div>
    </section>

    <!-- Next.js Project Generator Workspace -->
    <section class="nextjs-workspace view-hidden" id="nextjsView" aria-labelledby="nextjsTitle">
      <div class="nextjs-header">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <h1 class="nextjs-title" id="nextjsTitle">Next.js Project Generator</h1>
            <p class="nextjs-copy">Transform scraped website snapshots into production-ready Next.js 16 App Router projects with TypeScript, Server Components, local assets, and valid JSX.</p>
          </div>
          <div id="nextjsActiveJobBadge" class="badge-nextjs" style="display:none;">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-check-circle"></use></svg>
            <span id="nextjsJobLabel">Job Selected</span>
          </div>
        </div>
      </div>

      <!-- Section A: Snapshot Selector & Project Configuration -->
      <div id="nextjsSetupCard" class="card" style="margin-bottom:20px;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;">
          <span style="display:flex;align-items:center;gap:8px;">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-bolt"></use></svg> 1. Select Scrape Snapshot &amp; Output Options
          </span>
          <button class="btn-reset" style="margin-top:0;padding:5px 12px;font-size:11px;" onclick="refreshNextjsSnapshot()">Refresh from Scraper</button>
        </div>

        <div style="display:grid;grid-template-columns:1fr 180px;gap:14px;align-items:end;margin-top:14px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label" for="nextjsJobSelect">Target Scrape Job</label>
            <select id="nextjsJobSelect" class="strategy-select" onchange="handleNextjsJobSelect()">
              <option value="">-- Select a scraped job --</option>
            </select>
          </div>
          <button class="btn-submit" style="height:44px;margin-top:0;" onclick="loadCurrentJobSnapshot()">Load Snapshot</button>
        </div>

        <div id="nextjsOptionsContainer" style="display:none;margin-top:20px;border-top:1px solid var(--border);padding-top:20px;">
          <div class="options-grid">
            <div class="form-group">
              <label class="form-label" for="nextjsProjectName">Project Name</label>
              <input id="nextjsProjectName" class="proxy-input" value="scraped-website-app" placeholder="my-nextjs-project" autocomplete="off" spellcheck="false" style="margin-top:0;">
              <div class="field-hint">Alphanumeric, hyphens and underscores. Folder and package.json name.</div>
            </div>

            <div class="form-group">
              <label class="form-label">Styling Strategy</label>
              <select id="nextjsCssStrategy" class="strategy-select" style="margin-top:0;">
                <option value="original">Preserve Original CSS &amp; Fonts (Highest Fidelity)</option>
                <option value="tailwind">Convert Safe Styles to Tailwind CSS</option>
              </select>
              <div class="field-hint">Tailwind mode converts safe declarations to utilities and preserves complex rules as fallback CSS.</div>
            </div>

            <div class="form-group">
              <label class="form-label">Component Extraction Level</label>
              <select id="nextjsExtractionLevel" class="strategy-select" style="margin-top:0;">
                <option value="standard">Standard (Header, Footer, Sections, UI)</option>
                <option value="minimal">Minimal (Single Page with Layout)</option>
                <option value="deep">Deep (Granular Section Separation)</option>
              </select>
              <div class="field-hint">Extracts repeated sections into reusable React components.</div>
            </div>

            <div class="form-group">
              <label class="form-label">Advanced Preservation</label>
              <div class="toggle-group" style="margin-top:4px;">
                <label class="toggle-item" title="Extract interactivity to Client Components">
                  <input type="checkbox" id="nextjsPreserveInteractivity" class="toggle-checkbox" checked>
                  <span class="toggle-label">Interactive Hooks</span>
                </label>
                <label class="toggle-item" title="Preserve OpenGraph and SEO metadata">
                  <input type="checkbox" id="nextjsPreserveMetadata" class="toggle-checkbox" checked>
                  <span class="toggle-label">SEO Metadata</span>
                </label>
              </div>
            </div>
          </div>

          <!-- Page Selection Checklist -->
          <div style="margin-top:24px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <label class="form-label" style="margin-bottom:0;">Pages &amp; Routes to Include in Next.js Project</label>
              <div style="display:flex;gap:8px;">
                <button type="button" class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="toggleAllPages(true)">Select All</button>
                <button type="button" class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="toggleAllPages(false)">Deselect All</button>
              </div>
            </div>

            <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;max-height:260px;overflow-y:auto;background:var(--card-inner);">
              <table class="pages-table" id="nextjsPagesTable">
                <thead>
                  <tr>
                    <th style="width:40px;">Inc</th>
                    <th>Route</th>
                    <th>Page Title</th>
                    <th>Component</th>
                    <th>Source URL</th>
                  </tr>
                </thead>
                <tbody id="nextjsPagesList"></tbody>
              </table>
            </div>
          </div>

          <div style="margin-top:24px;display:flex;justify-content:flex-end;">
            <button id="btnStartConversion" class="btn-submit" style="max-width:280px;height:48px;font-size:14px;gap:8px;" onclick="executeNextjsConversion()">
              <svg class="icon" aria-hidden="true"><use href="#icon-bolt"></use></svg>
              <span>Convert to Next.js Project</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Section B: Live operation, backed by the real conversion record. -->
      <section id="nextjsProgressCard" class="card live-operation" style="display:none;margin-bottom:20px;" aria-labelledby="nextjsOperationTitle">
        <header class="operation-head">
          <span class="operation-step" aria-hidden="true">02</span>
          <div class="operation-heading"><h2 id="nextjsOperationTitle">Live operation</h2><p id="nextjsOperationProject">Waiting for a conversion</p></div>
          <span id="nextjsOperationStatus" class="operation-status" role="status" aria-live="polite">Not started</span>
        </header>
        <ol id="nextjsOperationPhases" class="operation-phases" aria-label="Conversion phases">
          <li class="operation-phase"><span>1</span>Discover</li>
          <li class="operation-phase"><span>2</span>Capture</li>
          <li class="operation-phase"><span>3</span>Generate</li>
          <li class="operation-phase"><span>4</span>Package</li>
        </ol>
        <div class="operation-summary">
          <div class="operation-task"><small id="nextjsOperationTaskLabel">Current task</small><strong id="nextjsOperationTask">Waiting for a conversion</strong><span id="nextjsOperationUrl"></span></div>
          <div class="operation-meta"><strong id="nextjsProgressPercent">0%</strong><small><span id="nextjsOperationPages">? pages</span> · <span id="nextjsOperationElapsed">—</span></small></div>
        </div>
        <div id="nextjsOperationProgress" class="operation-progress" role="progressbar" aria-label="Conversion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div id="nextjsProgressBar" style="width:0%;"></div></div>
        <div class="operation-console">
          <div class="operation-console-head"><span>conversion.log</span><button id="btnCopyOperationLogs" type="button" onclick="copyOperationLogs()" aria-label="Copy conversion log to clipboard">Copy</button></div>
          <pre id="nextjsOperationLogs" class="operation-logs" role="log" aria-live="polite" aria-label="Conversion log" tabindex="0">No conversion events yet.</pre>
        </div>
        <p id="nextjsOperationError" class="operation-error" role="alert" hidden></p>
        <div id="nextjsOperationFinished" class="operation-finished" hidden><span>Your project is ready.</span><button type="button" class="history-btn" onclick="downloadNextjsZip()">Download project</button></div>
        <details class="operation-details"><summary>Detailed pipeline · 11 stages</summary><div class="stages-list" id="nextjsStagesList"></div></details>
      </section>

      <!-- Section C: Generated Project Explorer & Download Card -->
      <div id="nextjsResultCard" class="card" style="display:none;">
        <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <span style="display:flex;align-items:center;gap:8px;">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-code"></use></svg> 3. Generated Project Preview &amp; Export
          </span>
          <div style="display:flex;align-items:center;gap:10px;">
            <span id="nextjsValidationBadge" class="badge-status">Validation: Not reported</span>
            <button id="btnDownloadZip" class="btn-download-hero" onclick="downloadNextjsZip()">
              <svg class="icon icon-lg" aria-hidden="true"><use href="#icon-download"></use></svg>
              <span>Download Project ZIP</span>
              <span id="nextjsZipSizeBadge" style="font-size:11px;opacity:0.85;background:rgba(0,0,0,0.25);padding:2px 6px;border-radius:4px;">0 KB</span>
            </button>
          </div>
        </div>

        <!-- Quickstart instructions -->
        <div style="margin-top:14px;padding:12px 16px;background:rgba(37,99,235,0.08);border:1px solid rgba(59,130,246,0.25);border-radius:8px;font-size:12px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
          <div style="color:#93c5fd;"><strong>Run Locally:</strong> <code>unzip project.zip &amp;&amp; cd project &amp;&amp; npm install &amp;&amp; npm run dev</code></div>
          <div style="color:var(--text-muted);">Next.js 16 App Router + TypeScript</div>
        </div>

        <section id="sitePreviewPanel" class="site-preview-panel" aria-labelledby="sitePreviewTitle">
          <div class="site-preview-toolbar">
            <h2 id="sitePreviewTitle" class="site-preview-title">Rendered website</h2>
            <span id="sitePreviewStatus" class="badge-status" role="status" aria-live="polite">Not started</span>
            <div class="site-preview-controls">
              <button id="btnStartSitePreview" class="history-btn" onclick="startSitePreview()" disabled>Start preview</button>
              <button id="btnStopSitePreview" class="history-btn" onclick="stopSitePreview()" disabled>Stop preview</button>
              <label for="sitePreviewRoute" class="field-hint">Route</label>
              <select id="sitePreviewRoute" class="history-select" onchange="refreshSitePreview()" disabled><option value="/">/</option></select>
              <button id="btnRefreshSitePreview" class="history-btn" onclick="refreshSitePreview()" disabled>Refresh</button>
            </div>
          </div>
          <p class="site-preview-note">Start explicitly to install dependencies, build, and run the generated Next.js app locally. Preview runs on a separate loopback origin. Stop it when finished.</p>
          <p id="sitePreviewError" class="site-preview-error" role="alert"></p>
          <div class="site-preview-viewport">
            <iframe id="sitePreviewFrame" class="site-preview-frame" title="Generated Next.js website preview" sandbox="allow-scripts allow-same-origin" referrerpolicy="no-referrer" hidden></iframe>
          </div>
          <details class="site-preview-logs"><summary>Preview logs</summary><pre id="sitePreviewLogs">No preview has been started.</pre></details>
        </section>

        <div class="project-explorer-header"><strong id="explorerProjectName">Generated project</strong><span id="explorerProjectSummary"></span><button class="history-btn" onclick="downloadNextjsZip()">Download ZIP</button></div>
        <!-- Two-Pane File Explorer -->
        <div class="explorer-grid">
          <div class="file-tree-pane">
            <div class="file-tree-title">Project Files (<span id="nextjsTotalFilesCount">0</span>)</div>
            <input id="explorerSearch" class="explorer-search" type="search" placeholder="Search files…" aria-label="Search project files" oninput="filterProjectFiles(this.value)">
            <div id="nextjsFileTree"></div>
          </div>
          <div class="file-content-pane">
            <div id="explorerOpenTabs" class="explorer-open-tabs" aria-label="Open project files"></div>
            <div class="file-content-header">
              <span id="nextjsActiveFilePath" class="file-path-badge">src/app/page.tsx</span>
              <button class="history-btn" style="padding:4px 8px;font-size:11px;" onclick="copyCurrentFileContent()">Copy File</button>
            </div>
            <div class="explorer-editor"><pre id="explorerLineNumbers" class="explorer-line-numbers">1</pre><pre class="file-code-view" id="nextjsFileContent">// Click any file in the tree to preview its generated code</pre></div>
            <div class="explorer-statusbar"><span id="explorerStatusPath">No file selected</span><span id="explorerStatusMeta">Text · UTF-8</span></div>
          </div>
        </div>
      </div>
    </section>
    ${renderHtmlGeneratorWorkspace()}
    ${renderExactCloneHtml()}
  </div>
  <script>
    let currentRawHtml = '';
    let currentJsonData = null;
    let currentCleanData = null;
    let currentHeaders = {
      'content-type': 'text/html; charset=utf-8',
      'server': 'Fastify / Crawlee',
      'cache-control': 'no-cache',
      'x-scraper-engine': 'CheerioCrawler / Playwright'
    };
    let activeView = 'html';
    let currentJobId = '';
    let currentTargetUrl = '';
    let activeConversionId = '';
    let currentConversionRecord = null;
    let currentPreviewInventory = null;
    let currentActiveFilePath = '';
    let explorerOpenFiles = [];
    function renderExplorerTabs() {
      const container = document.getElementById('explorerOpenTabs');
      container.replaceChildren();
      explorerOpenFiles.forEach(file => {
        const button = document.createElement('button');
        button.textContent = file.split('/').pop();
        button.title = file;
        button.classList.toggle('active', file === currentActiveFilePath);
        button.onclick = () => selectProjectFile(file);
        container.appendChild(button);
        const close = document.createElement('button');
        close.textContent = '×';
        close.setAttribute('aria-label', 'Close ' + file);
        close.onclick = () => {
          explorerOpenFiles = explorerOpenFiles.filter(item => item !== file);
          if (file === currentActiveFilePath && explorerOpenFiles.length) selectProjectFile(explorerOpenFiles[explorerOpenFiles.length - 1]);
          renderExplorerTabs();
        };
        container.appendChild(close);
      });
    }
    function filterProjectFiles(query) {
      if (query.trim()) {
        document.querySelectorAll('#nextjsFileTree .explorer-tree-children').forEach(node => { node.hidden = false; });
        document.querySelectorAll('#nextjsFileTree [aria-expanded]').forEach(node => node.setAttribute('aria-expanded', 'true'));
      }
      document.querySelectorAll('#nextjsFileTree [data-file-path]').forEach(node => {
        node.style.display = node.dataset.filePath.toLowerCase().includes(query.toLowerCase()) ? '' : 'none';
      });
    }
    function setExplorerContent(content, filePath) {
      document.getElementById('nextjsFileContent').textContent = content;
      const lines = content.split('\\n').length;
      document.getElementById('explorerLineNumbers').textContent = Array.from({length:lines}, (_, index) => index + 1).join('\\n');
      document.getElementById('explorerStatusPath').textContent = filePath;
      document.getElementById('explorerStatusMeta').textContent = (filePath.split('.').pop() || 'text').toUpperCase() + ' · ' + lines + ' lines · ' + new Blob([content]).size + ' B · UTF-8';
    }
    let sitePreviewGeneration = 0;
    let sitePreviewConversionId = '';
    let sitePreviewRecord = null;
    let sitePreviewTimer = null;
    let sitePreviewRequestPending = false;
    const SITE_PREVIEW_WORKING = ['INSTALLING', 'BUILDING', 'STARTING'];

    function detachSitePreviewFrame() {
      const frame = document.getElementById('sitePreviewFrame');
      frame.hidden = true;
      frame.removeAttribute('src');
    }

    function resetSitePreview(conversionId = '') {
      sitePreviewGeneration++;
      clearTimeout(sitePreviewTimer);
      sitePreviewTimer = null;
      sitePreviewConversionId = conversionId;
      sitePreviewRecord = null;
      sitePreviewRequestPending = false;
      detachSitePreviewFrame();
      document.getElementById('sitePreviewError').textContent = '';
      document.getElementById('sitePreviewLogs').textContent = 'No preview has been started.';
      document.getElementById('sitePreviewRoute').replaceChildren();
      updateSitePreviewControls();
    }

    function updateSitePreviewControls() {
      const status = sitePreviewRecord?.status;
      const working = SITE_PREVIEW_WORKING.includes(status);
      const ready = status === 'READY';
      document.getElementById('sitePreviewStatus').textContent = status || 'Not started';
      document.getElementById('btnStartSitePreview').disabled = !sitePreviewConversionId || sitePreviewRequestPending || working || ready;
      document.getElementById('btnStopSitePreview').disabled = !sitePreviewConversionId || !(working || ready || sitePreviewRequestPending);
      document.getElementById('sitePreviewRoute').disabled = !ready;
      document.getElementById('btnRefreshSitePreview').disabled = !ready;
    }

    function configureSitePreview(record) {
      if (sitePreviewConversionId !== record.id) resetSitePreview(record.id);
      const select = document.getElementById('sitePreviewRoute');
      const previous = select.value;
      select.replaceChildren();
      const routes = Array.isArray(record.inventory?.routes) ? record.inventory.routes : [];
      for (const route of routes.length ? routes : ['/']) {
        const option = document.createElement('option');
        option.value = typeof route === 'string' ? route : route.path;
        option.textContent = typeof route === 'string' ? route : (route.label || route.path);
        select.appendChild(option);
      }
      if (Array.from(select.options).some(option => option.value === previous)) select.value = previous;
      updateSitePreviewControls();
    }

    function getSitePreviewUrl(baseUrl, route) {
      const base = new URL(baseUrl);
      const loopback = base.hostname === 'localhost' || base.hostname === '[::1]' || /^127\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$/.test(base.hostname);
      if (base.protocol !== 'http:' || !loopback || !base.port || base.origin === window.location.origin || base.username || base.password || base.search || base.hash) {
        throw new Error('Preview must use a separate HTTP loopback origin and port.');
      }
      // Only inventory-relative paths are accepted; never append credentials or an API key.
      if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('\\\\') || route.includes('?') || route.includes('#')) {
        throw new Error('Invalid preview route. Select a relative inventory route.');
      }
      const target = new URL(route, base);
      if (target.origin !== base.origin) throw new Error('Preview route must stay on the preview origin.');
      return target.href;
    }

    function refreshSitePreview() {
      if (sitePreviewRecord?.status !== 'READY') return;
      try {
        const url = getSitePreviewUrl(sitePreviewRecord.url, document.getElementById('sitePreviewRoute').value);
        const frame = document.getElementById('sitePreviewFrame');
        frame.src = url;
        frame.hidden = false;
        document.getElementById('sitePreviewError').textContent = '';
      } catch (error) {
        detachSitePreviewFrame();
        document.getElementById('sitePreviewError').textContent = error.message;
      }
    }

    function applySitePreviewRecord(record) {
      if (!record || record.conversionId !== sitePreviewConversionId || !['INSTALLING', 'BUILDING', 'STARTING', 'READY', 'FAILED', 'STOPPED'].includes(record.status) || !Array.isArray(record.logs) || !record.logs.every(log => typeof log === 'string') || typeof record.updatedAt !== 'string') {
        throw new Error('Invalid preview status response.');
      }
      sitePreviewRecord = record;
      document.getElementById('sitePreviewLogs').textContent = record.logs.join('\\n') || 'No logs yet.';
      document.getElementById('sitePreviewError').textContent = record.errorMessage || '';
      updateSitePreviewControls();
      if (record.status === 'READY') refreshSitePreview();
      else detachSitePreviewFrame();
    }

    async function requestSitePreview(method, conversionId) {
      const response = await fetch('/api/v1/conversions/' + encodeURIComponent(conversionId) + '/preview', {
        method,
        headers: { 'x-api-key': '${defaultApiKey}' }
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.success !== true) {
        const error = new Error(body.error?.message || (response.status === 409 ? 'Another preview is active. Stop it before starting this preview.' : 'Preview request failed (HTTP ' + response.status + ').'));
        error.status = response.status;
        throw error;
      }
      return body.data;
    }

    function scheduleSitePreviewPoll(generation, conversionId) {
      clearTimeout(sitePreviewTimer);
      if (generation !== sitePreviewGeneration || !SITE_PREVIEW_WORKING.includes(sitePreviewRecord?.status)) return;
      sitePreviewTimer = setTimeout(async () => {
        if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
        try {
          const record = await requestSitePreview('GET', conversionId);
          if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
          applySitePreviewRecord(record);
          scheduleSitePreviewPoll(generation, conversionId);
        } catch (error) {
          if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
          handleSitePreviewError(error);
        }
      }, 1000);
    }

    function handleSitePreviewError(error) {
      clearTimeout(sitePreviewTimer);
      sitePreviewTimer = null;
      detachSitePreviewFrame();
      if (error.status === 401 || error.status === 404) {
        sitePreviewRecord = null;
        sitePreviewConversionId = '';
      }
      document.getElementById('sitePreviewError').textContent = error.message;
      updateSitePreviewControls();
    }

    async function startSitePreview() {
      if (!sitePreviewConversionId || sitePreviewRequestPending || SITE_PREVIEW_WORKING.includes(sitePreviewRecord?.status) || sitePreviewRecord?.status === 'READY') return;
      const generation = ++sitePreviewGeneration;
      const conversionId = sitePreviewConversionId;
      clearTimeout(sitePreviewTimer);
      detachSitePreviewFrame();
      sitePreviewRequestPending = true;
      document.getElementById('sitePreviewError').textContent = '';
      updateSitePreviewControls();
      try {
        const record = await requestSitePreview('POST', conversionId);
        if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
        sitePreviewRequestPending = false;
        applySitePreviewRecord(record);
        scheduleSitePreviewPoll(generation, conversionId);
      } catch (error) {
        if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
        sitePreviewRequestPending = false;
        handleSitePreviewError(error);
      }
    }

    async function stopSitePreview() {
      if (!sitePreviewConversionId) return;
      const generation = ++sitePreviewGeneration;
      const conversionId = sitePreviewConversionId;
      clearTimeout(sitePreviewTimer);
      detachSitePreviewFrame();
      sitePreviewRequestPending = true;
      updateSitePreviewControls();
      document.getElementById('btnStopSitePreview').disabled = true;
      try {
        const record = await requestSitePreview('DELETE', conversionId);
        if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
        sitePreviewRequestPending = false;
        applySitePreviewRecord(record);
      } catch (error) {
        if (generation !== sitePreviewGeneration || conversionId !== sitePreviewConversionId) return;
        sitePreviewRequestPending = false;
        handleSitePreviewError(error);
      }
    }

    const HISTORY_DB_NAME = 'scraper-playground';
    const HISTORY_STORE_NAME = 'scrape-runs';
    const HISTORY_LIMIT = 30;

    function openHistoryDb() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(HISTORY_DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(HISTORY_STORE_NAME)) {
            const store = db.createObjectStore(HISTORY_STORE_NAME, { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt');
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }

    async function getHistoryRuns() {
      const db = await openHistoryDb();
      return new Promise((resolve, reject) => {
        const request = db.transaction(HISTORY_STORE_NAME, 'readonly').objectStore(HISTORY_STORE_NAME).getAll();
        request.onsuccess = () => {
          db.close();
          resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
        };
        request.onerror = () => { db.close(); reject(request.error); };
      });
    }

    async function saveHistoryRun(run) {
      const db = await openHistoryDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction(HISTORY_STORE_NAME, 'readwrite').objectStore(HISTORY_STORE_NAME).put(run);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      db.close();

      const runs = await getHistoryRuns();
      if (runs.length > HISTORY_LIMIT) {
        const trimDb = await openHistoryDb();
        const transaction = trimDb.transaction(HISTORY_STORE_NAME, 'readwrite');
        runs.slice(HISTORY_LIMIT).forEach(item => transaction.objectStore(HISTORY_STORE_NAME).delete(item.id));
        await new Promise((resolve, reject) => {
          transaction.oncomplete = resolve;
          transaction.onerror = () => reject(transaction.error);
        });
        trimDb.close();
      }
      await refreshHistory(run.id);
    }

    async function refreshHistory(selectedId = '') {
      const select = document.getElementById('historySelect');
      try {
        const runs = await getHistoryRuns();
        select.innerHTML = runs.length
          ? runs.map(run => {
              const label = new Date(run.createdAt).toLocaleString() + ' â€” ' + run.targetUrl;
              return '<option value="' + run.id + '">' + escapeHtml(label) + '</option>';
            }).join('')
          : '<option value="">No saved runs yet</option>';
        if (selectedId && runs.some(run => run.id === selectedId)) select.value = selectedId;
      } catch (error) {
        select.innerHTML = '<option value="">History unavailable</option>';
        console.error('Unable to read scrape history', error);
      }
      updateHistoryButtons();
    }

    function escapeHtml(value) {
      const element = document.createElement('span');
      element.textContent = value;
      return element.innerHTML;
    }

    function updateHistoryButtons() {
      const hasSelection = Boolean(document.getElementById('historySelect').value);
      document.getElementById('loadHistoryBtn').disabled = !hasSelection;
      document.getElementById('deleteHistoryBtn').disabled = !hasSelection;
    }

    async function loadHistoryRun() {
      const id = document.getElementById('historySelect').value;
      if (!id) return;
      const runs = await getHistoryRuns();
      const run = runs.find(item => item.id === id);
      if (!run) return;
      currentJobId = run.id;
      currentTargetUrl = run.targetUrl || '';
      currentRawHtml = run.rawHtml || '';
      currentJsonData = run.jsonData ?? null;
      currentCleanData = run.cleanData ?? null;
      currentHeaders = run.headers || {};
      document.getElementById('targetUrl').value = run.targetUrl || '';
      document.getElementById('strategy').value = run.strategy || 'AUTO';
      syncRenderJsWithStrategy();
      const restoredScope = ['landing', 'count', 'full', 'specific'].includes(run.crawlScope) ? run.crawlScope : 'landing';
      const scopeInput = document.querySelector('input[name="crawlScope"][value="' + restoredScope + '"]');
      if (scopeInput) scopeInput.checked = true;
      document.getElementById('pageCount').value = String(clampPageCount(run.pageCount || 10));
      document.getElementById('specificMaxPages').value = String(clampSpecificMaxPages(run.specificMaxPages || 20));
      document.getElementById('specificPageKeywords').value = Array.isArray(run.specificPageKeywords) && run.specificPageKeywords.length ? run.specificPageKeywords.join('\\n') : 'about us\\ncontact us';
      document.getElementById('respStatus').innerText = 'Status: Saved';
      handleScopeChange();
      setResponseView(activeView);
    }

    async function deleteHistoryRun() {
      const id = document.getElementById('historySelect').value;
      if (!id) return;
      const db = await openHistoryDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction(HISTORY_STORE_NAME, 'readwrite').objectStore(HISTORY_STORE_NAME).delete(id);
        request.onsuccess = resolve;
        request.onerror = () => reject(request.error);
      });
      db.close();
      await refreshHistory();
    }

    function setLineNumbers(text) {
      const lineCount = (text.split('\\n').length) || 1;
      let gutterText = '';
      for (let i = 1; i <= lineCount; i++) {
        gutterText += i + '\\n';
      }
      document.getElementById('lineGutter').innerText = gutterText;
      document.getElementById('editorContent').innerText = text;
    }

    function renderScrapePreview() {
      const doc = new DOMParser().parseFromString(currentRawHtml || '<p>No scraped HTML yet. Run a scrape first.</p>', 'text/html');
      doc.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv], link[rel="preload"], link[rel="modulepreload"]').forEach(node => node.remove());
      doc.querySelectorAll('*').forEach(node => {
        Array.from(node.attributes).forEach(attribute => {
          if (attribute.name.toLowerCase().startsWith('on')) node.removeAttribute(attribute.name);
        });
      });
      const policy = doc.createElement('meta');
      policy.httpEquiv = 'Content-Security-Policy';
      policy.content = "default-src 'none'; img-src http: https: data:; style-src http: https: 'unsafe-inline'; font-src http: https: data:; media-src http: https: data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri http: https:";
      doc.head.prepend(policy);
      try {
        const target = new URL(currentTargetUrl);
        if (target.protocol === 'https:' || target.protocol === 'http:') {
          const base = doc.createElement('base');
          base.href = target.href;
          // Resolve assets before serialization; a base after stylesheet links
          // is too late for the HTML parser's initial resource requests.
          doc.querySelectorAll('[href], [src], [poster], [data-src]').forEach(node => {
            ['href', 'src', 'poster', 'data-src'].forEach(attribute => {
              const value = node.getAttribute(attribute);
              if (!value || value.startsWith('#') || /^(data:|blob:|mailto:|tel:)/i.test(value)) return;
              try { node.setAttribute(attribute, new URL(value, target.href).href); } catch { /* Preserve unsupported values. */ }
            });
          });
          doc.querySelectorAll('link[rel="stylesheet"]').forEach(node => {
            node.removeAttribute('crossorigin');
            node.removeAttribute('integrity');
          });
          doc.head.insertBefore(base, policy.nextSibling);
        }
      } catch { /* No source URL for an empty response. */ }
      document.getElementById('scrapePreviewFrame').srcdoc = '<!DOCTYPE html>' + doc.documentElement.outerHTML;
    }

    function setResponseView(view) {
      activeView = view;
      document.getElementById('tabScrapePreview').classList.toggle('active', view === 'preview');
      document.getElementById('editorWrap').style.display = view === 'preview' ? 'none' : '';
      document.getElementById('scrapePreviewPane').style.display = view === 'preview' ? 'block' : 'none';
      if (view === 'preview') renderScrapePreview();
      document.getElementById('tabResponse').classList.toggle('active', view === 'html');
      document.getElementById('tabExtracted').classList.toggle('active', view === 'json');
      document.getElementById('tabCleanData').classList.toggle('active', view === 'clean');
      document.getElementById('tabHeaders').classList.toggle('active', view === 'headers');

      if (view === 'html') {
        setLineNumbers(currentRawHtml || '<!-- No HTML response yet. Click Try it to run -->');
      } else if (view === 'json') {
        const text = currentJsonData ? JSON.stringify(currentJsonData, null, 2) : '// No JSON data extracted yet';
        setLineNumbers(text);
      } else if (view === 'clean') {
        setLineNumbers(currentCleanData ? JSON.stringify(currentCleanData, null, 2) : '// No Clean Data extracted yet');
      } else if (view === 'headers') {
        setLineNumbers(JSON.stringify(currentHeaders, null, 2));
      }
    }

    function syncRenderJsWithStrategy() {
      document.getElementById('renderJs').checked = document.getElementById('strategy').value === 'PLAYWRIGHT';
    }

    function handleStrategyChange() {
      syncRenderJsWithStrategy();
      updateCodeSnippet();
    }

    function handleJsToggle() {
      const isJs = document.getElementById('renderJs').checked;
      document.getElementById('strategy').value = isJs ? 'PLAYWRIGHT' : 'AUTO';
      updateCodeSnippet();
    }

    function toggleOutputFormat() {
      const isHtml = document.getElementById('outputFormat').checked;
      setResponseView(isHtml ? 'html' : 'json');
    }

    function clampPageCount(value) {
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? Math.min(500, Math.max(1, parsed)) : 1;
    }

    function normalizeSpecificPhrase(value) {
      return value.normalize('NFKC').toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, ' ').trim().replace(/\\s+/g, ' ');
    }

    function getSpecificPageKeywords() {
      return document.getElementById('specificPageKeywords').value.split(/\\r?\\n/).map(normalizeSpecificPhrase).filter(Boolean);
    }

    function clampSpecificMaxPages(value) {
      const parsed = Number.parseInt(String(value), 10);
      return Number.isFinite(parsed) ? Math.min(500, Math.max(2, parsed)) : 20;
    }

    function validateSpecificSettings(report) {
      const keywordsInput = document.getElementById('specificPageKeywords');
      const maxPagesInput = document.getElementById('specificMaxPages');
      const keywords = getSpecificPageKeywords();
      const hasRawInput = keywordsInput.value.trim().length > 0;
      const invalidPhrase = keywords.find(keyword => keyword.length < 2 || keyword.length > 64);
      const totalLength = keywords.reduce((total, keyword) => total + keyword.length, 0);
      keywordsInput.setCustomValidity(hasRawInput && keywords.length === 0 ? 'Enter a phrase containing letters or numbers. A slash alone is not a page phrase; the landing page is already included.' : keywords.length < 1 || keywords.length > 20 ? 'Enter 1 to 20 phrases.' : invalidPhrase ? 'Each normalized phrase must contain 2 to 64 characters.' : totalLength > 512 ? 'Phrases must total 512 characters or fewer.' : '');
      maxPagesInput.setCustomValidity(Number(maxPagesInput.value) >= 2 && Number(maxPagesInput.value) <= 500 ? '' : 'Enter a number from 2 to 500.');
      return report ? keywordsInput.reportValidity() && maxPagesInput.reportValidity() : !keywordsInput.validationMessage && !maxPagesInput.validationMessage;
    }

    function getCrawlSettings() {
      const selected = document.querySelector('input[name="crawlScope"]:checked');
      const crawlScope = selected ? selected.value : 'landing';
      const pageCount = clampPageCount(document.getElementById('pageCount').value);
      if (crawlScope === 'specific') return { crawlScope, pageCount: clampSpecificMaxPages(document.getElementById('specificMaxPages').value), specificMaxPages: clampSpecificMaxPages(document.getElementById('specificMaxPages').value), specificPageKeywords: getSpecificPageKeywords(), maxDepth: 10, maxPages: clampSpecificMaxPages(document.getElementById('specificMaxPages').value), discoverLinks: true };
      if (crawlScope === 'full') return { crawlScope, pageCount: 500, maxDepth: 10, maxPages: 500, discoverLinks: true };
      if (crawlScope === 'count') return { crawlScope, pageCount, maxDepth: 10, maxPages: pageCount, discoverLinks: pageCount > 1 };
      return { crawlScope: 'landing', pageCount: 1, maxDepth: 0, maxPages: 1, discoverLinks: false };
    }

    function handleScopeChange() {
      const settings = getCrawlSettings();
      document.getElementById('pageCountWrap').hidden = settings.crawlScope !== 'count';
      document.getElementById('specificSettings').hidden = settings.crawlScope !== 'specific';
      updateCodeSnippet();
    }

    function handlePageCountChange() {
      const input = document.getElementById('pageCount');
      input.setCustomValidity(Number(input.value) >= 1 && Number(input.value) <= 500 ? '' : 'Enter a number from 1 to 500.');
      updateCodeSnippet();
    }

    function selectSpecificScope() {
      const specificScope = document.querySelector('input[name="crawlScope"][value="specific"]');
      if (specificScope && !specificScope.checked) {
        specificScope.checked = true;
        document.getElementById('pageCountWrap').hidden = true;
        document.getElementById('specificSettings').hidden = false;
      }
    }

    function handleSpecificSettingsChange() {
      selectSpecificScope();
      validateSpecificSettings(false);
      updateCodeSnippet();
    }

    function buildJobPayload(targetUrl, strategy) {
      const settings = getCrawlSettings();
      const proxyId = document.getElementById('enableProxy').checked ? document.getElementById('proxySelect').value : '';
      return {
        ...(proxyId ? { proxyId } : {}),
        targetUrl, strategy,
        maxDepth: settings.maxDepth,
        maxPages: settings.maxPages,
        requestTimeoutMs: 60000,
        extractionConfig: {
          extractHtml: true, extractMetadata: true, extractHeadings: true, extractMainText: true, extractLinks: true,
          discoverLinks: settings.discoverLinks,
          specificPageKeywords: settings.crawlScope === 'specific' ? settings.specificPageKeywords : [],
          filterInternalLinksOnly: true,
          maxLinksPerPage: 500,
          extractImages: true,
          extractJsonLd: true
        }
      };
    }

    function updateCodeSnippet() {
      const targetUrl = document.getElementById('targetUrl').value.trim();
      const apiKey = '${defaultApiKey}';
      const strategy = document.getElementById('strategy').value;
      const json = JSON.stringify(buildJobPayload(targetUrl || 'https://example.com', strategy), null, 2).replace(/'/g, "'\\\\''");
      const code = \`curl --request POST --location 'http://localhost:3200/api/v1/jobs' \\\\
  --header 'Content-Type: application/json' \\\\
  --header 'x-api-key: \${apiKey}' \\\\
  --data '\${json}'\`;
      document.getElementById('codeSnippet').innerText = code;
    }

    async function fetchAllResults(jobId, apiKey) {
      const allResults = [];
      const limit = 200;
      let offset = 0;
      let total = 0;
      do {
        const response = await fetch(\`/api/v1/jobs/\${jobId}/results?limit=\${limit}&offset=\${offset}\`, { headers: { 'x-api-key': apiKey } });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || 'Unable to fetch crawl results');
        const page = Array.isArray(body.data) ? body.data : [];
        allResults.push(...page);
        total = Number(body.pagination?.total ?? allResults.length);
        offset += page.length;
        if (page.length === 0) break;
      } while (offset < total);
      return allResults;
    }

    async function fetchCleanData(jobId, apiKey) {
      const response = await fetch(\`/api/v1/jobs/\${jobId}/clean-data\`, { headers: { 'x-api-key': apiKey } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || 'Unable to fetch Clean Data');
      return body.data;
    }

    let scrapeOperationStarted = 0;
    let scrapeOperationLastUpdate = '';
    let scrapeOperationLogEntries = [];
    function renderScrapeOperation(job, phase, message) {
      document.getElementById('scrapeOperationCard').style.display = 'block';
      const status = job.status || 'SUBMITTING';
      document.getElementById('scrapeOperationStatus').textContent = status.replaceAll('_', ' ');
      document.getElementById('scrapeOperationUrl').textContent = job.targetUrl || currentTargetUrl;
      const terminal = ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(status);
      const completed = phase === 'done' && ['COMPLETED', 'PARTIALLY_COMPLETED'].includes(status);
      const active = { submit:0, crawl:1, results:2, done:3 }[phase] ?? 0;
      const steps = ['Validate / Queue', 'Capture pages', 'Load results', 'Finished'];
      const container = document.getElementById('scrapeOperationSteps');
      container.replaceChildren();
      steps.forEach((label, index) => {
        const item = document.createElement('span');
        item.textContent = (completed || index < active ? '✓ ' : index === active ? '• ' : '○ ') + label;
        item.style.fontWeight = index === active ? '700' : '400';
        container.appendChild(item);
      });
      const crawled = Number(job.totalPagesCrawled || 0);
      const limit = Number(job.maxPages || 0);
      const elapsed = Math.floor((Date.now() - scrapeOperationStarted) / 1000);
      document.getElementById('scrapeOperationSummary').textContent = message + ' · ' + crawled + ' captured / ' + limit + ' maximum · ' + elapsed + 's · Strategy: ' + (job.strategy || 'AUTO');
      const progress = document.getElementById('scrapeOperationProgress');
      progress.max = Math.max(1, limit);
      if (completed) progress.value = progress.max;
      else if (crawled > 0) progress.value = Math.min(crawled, progress.max);
      else progress.removeAttribute('value');
      if (terminal && !completed && !crawled) progress.value = 0;
      const update = phase + ':' + status + ':' + crawled + ':' + message;
      if (update !== scrapeOperationLastUpdate) {
        scrapeOperationLastUpdate = update;
        scrapeOperationLogEntries.push(new Date().toLocaleTimeString() + '  ' + message + ' [' + status + ', ' + crawled + ' pages]');
        if (scrapeOperationLogEntries.length > 150) scrapeOperationLogEntries.shift();
        const logs = document.getElementById('scrapeOperationLogs');
        logs.textContent = scrapeOperationLogEntries.join('\\n');
        logs.scrollTop = logs.scrollHeight;
      }
    }

    async function executeScrape() {
      const btn = document.getElementById('btnTryIt');
      const targetUrl = document.getElementById('targetUrl').value.trim();
      if (!targetUrl) {
        document.getElementById('respStatus').innerText = 'Status: Enter a URL';
        document.getElementById('targetUrl').focus();
        return;
      }
      const renderJs = document.getElementById('renderJs').checked;
      let strategy = document.getElementById('strategy').value;
      if (renderJs) {
        strategy = 'PLAYWRIGHT';
      }
      const apiKey = '${defaultApiKey}';
      const settings = getCrawlSettings();
      const pageCountInput = document.getElementById('pageCount');
      if (settings.crawlScope === 'count' && !pageCountInput.reportValidity()) return;
      if (settings.crawlScope === 'specific' && !validateSpecificSettings(true)) return;

      scrapeOperationStarted = Date.now();
      scrapeOperationLastUpdate = '';
      scrapeOperationLogEntries = [];
      currentRawHtml = '';
      currentJsonData = null;
      currentCleanData = null;
      setResponseView(activeView);
      renderScrapeOperation({targetUrl, strategy, maxPages:settings.maxPages}, 'submit', 'Submitting URL for server validation and queue admission');
      btn.disabled = true;
      document.getElementById('btnText').innerText = 'Sending...';
      document.getElementById('respStatus').innerText = 'Status: Fetching...';

      try {
        const submitRes = await fetch('/api/v1/jobs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          },
          body: JSON.stringify(buildJobPayload(targetUrl, strategy))
        });

        const submitData = await submitRes.json();
        if (!submitRes.ok) throw new Error(submitData.error?.message || 'Submission failed');

        const jobId = submitData.data.id;
        currentJobId = jobId;
        currentTargetUrl = targetUrl;
        document.getElementById('respStatus').innerText = 'Status: Crawling...';

        // Poll for result
        let attempts = 0;
        let job = submitData.data;
        // Dynamic feeds can take longer than static pages because lazy content must load.
        while (attempts < 150) {
          await new Promise(r => setTimeout(r, 800));
          attempts++;
          const checkRes = await fetch(\`/api/v1/jobs/\${jobId}\`, {
            headers: { 'x-api-key': apiKey }
          });
          const checkData = await checkRes.json();
          if (!checkRes.ok) throw new Error(checkData.error?.message || 'Unable to read crawl progress');
          job = checkData.data;
          const crawled = Number(job.totalPagesCrawled || 0);
          document.getElementById('respStatus').innerText = 'Status: Crawling ' + crawled + '/' + settings.maxPages + ' pages';
          document.getElementById('btnText').innerText = 'Crawling ' + crawled + '/' + settings.maxPages;
          renderScrapeOperation(job, 'crawl', job.status === 'PENDING' ? 'Queued; waiting for worker' : 'Worker capturing eligible pages');
          if (['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) break;
        }

        if (!['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) {
          renderScrapeOperation(job, 'crawl', 'Crawl is still running on the server; this monitoring window has ended');
          return;
        }
        if (job.status === 'CANCELLED') {
          renderScrapeOperation(job, 'crawl', 'Crawl cancelled');
          return;
        }
        if (job.status === 'FAILED') {
          throw new Error(job.errorMessage || 'The crawl failed');
        }
        document.getElementById('respStatus').innerText = 'Status: 200';

        // Fetch every paginated result. HTML shows the first page; JSON preserves every page and URL.
        renderScrapeOperation(job, 'results', 'Loading captured HTML and extracted results');
        const results = await fetchAllResults(jobId, apiKey);
        currentCleanData = await fetchCleanData(jobId, apiKey).catch(() => null);

        if (results.length > 0) {
          const item = results[0];
          currentTargetUrl = item.url || targetUrl;
          currentRawHtml = item.rawData?.html || item.normalizedData?.mainText || '';
          currentJsonData = {
            jobId,
            pageCount: results.length,
            urls: results.map(result => result.url || result.rawData?.url || result.normalizedData?.url).filter(Boolean),
            pages: results.map(result => ({
              url: result.url || result.rawData?.url || result.normalizedData?.url,
              ...(result.rawData ? { ...result.rawData, html: undefined } : result.normalizedData)
            }))
          };
          currentHeaders['date'] = new Date().toUTCString();
          currentHeaders['content-length'] = String(currentRawHtml.length);
        } else {
          throw new Error(job.errorMessage || 'The crawl completed without extractable data');
        }

        await saveHistoryRun({
          id: jobId,
          createdAt: Date.now(),
          targetUrl,
          strategy,
          crawlScope: settings.crawlScope,
          pageCount: settings.pageCount,
          specificMaxPages: settings.specificMaxPages || 20,
          specificPageKeywords: settings.specificPageKeywords || [],
          rawHtml: currentRawHtml,
          jsonData: currentJsonData,
          cleanData: currentCleanData,
          headers: { ...currentHeaders }
        }).catch(error => console.warn('History could not be saved', error));
        renderScrapeOperation(job, 'done', job.status === 'PARTIALLY_COMPLETED' ? 'Partial capture finished; some pages failed' : 'Capture complete; response and preview are ready');
        setResponseView(activeView);

      } catch (err) {
        document.getElementById('respStatus').innerText = 'Status: Error';
        renderScrapeOperation({status:'FAILED', targetUrl, strategy, maxPages:settings.maxPages}, 'crawl', err.message);
        setLineNumbers(\`Error executing scrape:\\n\${err.message}\`);
      } finally {
        btn.disabled = false;
        document.getElementById('btnText').innerText = 'Try it';
      }
    }

    function copyResponse() {
      const text = activeView === 'preview' ? currentRawHtml : document.getElementById('editorContent').innerText;
      navigator.clipboard.writeText(text);
      alert('Response copied to clipboard!');
    }

    function downloadResponse() {
      const text = activeView === 'preview' ? currentRawHtml : document.getElementById('editorContent').innerText;
      const blob = new Blob([text], { type: (activeView === 'html' || activeView === 'preview') ? 'text/html' : 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (activeView === 'html' || activeView === 'preview') ? 'response.html' : 'response.json';
      a.click();
    }

    function promptSearch() {
      const q = prompt('Search text in response:');
      if (!q) return;
      const content = document.getElementById('editorContent').innerText;
      const index = content.toLowerCase().indexOf(q.toLowerCase());
      if (index !== -1) {
        alert(\`Found match at character position \${index}!\`);
      } else {
        alert('No match found.');
      }
    }

    function resetDefaults() {
      document.getElementById('targetUrl').value = '';
      currentCleanData = null;
      document.getElementById('strategy').value = 'AUTO';
      document.getElementById('renderJs').checked = false;
      document.getElementById('enableProxy').checked = false;
      document.getElementById('proxySelect').disabled = true;
      document.querySelector('input[name="crawlScope"][value="landing"]').checked = true;
      document.getElementById('pageCount').value = '10';
      document.getElementById('specificMaxPages').value = '20';
      document.getElementById('specificPageKeywords').value = 'about us\\ncontact us';
      document.getElementById('pageCount').setCustomValidity('');
      document.getElementById('specificMaxPages').setCustomValidity('');
      document.getElementById('specificPageKeywords').setCustomValidity('');
      handleScopeChange();
    }

    const proxyHeaders = { 'Content-Type': 'application/json', 'x-api-key': '${defaultApiKey}' };
    const dashboardRoutes = ${JSON.stringify(DASHBOARD_ROUTES)};
    function dashboardViewFromPath() {
      const path = window.location.pathname.replace(/\\/+$/, '') || '/';
      return Object.keys(dashboardRoutes).find(view => dashboardRoutes[view] === path) || 'playground';
    }
    function showView(view, updateHistory = true) {
      if (!Object.prototype.hasOwnProperty.call(dashboardRoutes, view)) view = 'playground';
      if (updateHistory && window.location.pathname !== dashboardRoutes[view]) {
        window.history.pushState({view}, '', dashboardRoutes[view]);
      }
      document.title = ({playground:'Playground', nextjs:'Next.js Generator', html:'HTML generator', exact:'Exact clone', proxies:'Proxies'}[view]) + ' | Scrape Platform';
      ['playground', 'nextjs', 'html', 'exact', 'proxies'].forEach(name => {
        const nav = document.getElementById(name === 'playground' ? 'playgroundNav' : name === 'nextjs' ? 'nextjsNav' : name === 'proxies' ? 'proxiesNav' : name + 'Nav');
        if (name === view) nav.setAttribute('aria-current', 'page'); else nav.removeAttribute('aria-current');
      });
      const isProxy = view === 'proxies';
      const isNextjs = view === 'nextjs';
      const isHtml = view === 'html';
      const isExact = view === 'exact';
      document.getElementById('htmlView').classList.toggle('view-hidden', !isHtml);
      document.getElementById('htmlNav').classList.toggle('active', isHtml);
      document.getElementById('exactView').classList.toggle('view-hidden', !isExact);
      document.getElementById('exactNav').classList.toggle('active', isExact);
      document.getElementById('playgroundView').classList.toggle('view-hidden', isProxy || isNextjs || isHtml || isExact);
      document.getElementById('proxiesView').classList.toggle('view-hidden', !isProxy);
      document.getElementById('nextjsView').classList.toggle('view-hidden', !isNextjs);
      document.getElementById('playgroundNav').classList.toggle('active', !isProxy && !isNextjs && !isHtml && !isExact);
      document.getElementById('proxiesNav').classList.toggle('active', isProxy);
      document.getElementById('nextjsNav').classList.toggle('active', isNextjs);
      document.querySelector('.top-title').innerText = isProxy ? 'Proxies' : isNextjs ? 'Next.js Generator' : isHtml ? 'HTML generator' : isExact ? 'Exact clone' : 'Playground';
      if (isProxy) loadProxies();
      if (isNextjs) populateNextjsJobsList();
      if (isHtml && !htmlGenerator.busy) { populateHtmlJobsList(); loadProxies(); }
      if (isExact && !exactGenerator.busy) populateExactJobsList();
    }
    window.addEventListener('popstate', () => showView(dashboardViewFromPath(), false));
    window.addEventListener('DOMContentLoaded', () => showView(dashboardViewFromPath(), false));
    function handleProxyToggle(){ document.getElementById('proxySelect').disabled=!document.getElementById('enableProxy').checked; updateCodeSnippet(); }
    async function proxyRequest(url, options={}) { const response=await fetch(url,{...options,headers:{...proxyHeaders,...(options.headers||{})}}); if(response.status===204)return null; const body=await response.json(); if(!response.ok)throw new Error(body.error?.message||'Proxy request failed'); return body.data; }
    async function loadProxies() {
      try {
        const items = await proxyRequest('/api/v1/proxies');
        for (const id of ['proxySelect', 'htmlProxySelect']) {
          const select = document.getElementById(id);
          // Never replace the active HTML route during a scrape/conversion.
          if (!select || (id === 'htmlProxySelect' && htmlGenerator.busy)) continue;
          const oldSelection = select.value;
          select.innerHTML = '<option value="">Select a proxy</option>' + items.map(proxy => '<option value="' + escapeHtml(proxy.id) + '">' + escapeHtml(proxy.name || proxy.displayUrl) + '</option>').join('');
          if (items.some(proxy => proxy.id === oldSelection)) select.value = oldSelection;
        }
        handleHtmlProxyToggle();

        document.getElementById('proxyTotalCount').innerText = String(items.length);
        document.getElementById('proxyCountBadge').innerText = items.length + (items.length === 1 ? ' proxy' : ' proxies');
        document.getElementById('proxyList').innerHTML = items.length
          ? items.map(proxy => {
              const status = proxy.status || 'UNTESTED';
              const statusLabel = status.replaceAll('_', ' ');
              const latency = proxy.latencyMs == null ? 'Not measured' : proxy.latencyMs + ' ms';
              const testedAt = proxy.testedAt ? new Date(proxy.testedAt).toLocaleString() : 'Never tested';
              return '<article class="proxy-row">' +
                '<div class="proxy-name-wrap"><span class="proxy-cell-label">Name</span><div class="proxy-name">' + escapeHtml(proxy.name || 'Unnamed proxy') + '</div></div>' +
                '<div class="proxy-address"><span class="proxy-cell-label">Proxy address</span><code class="proxy-url" title="' + escapeHtml(proxy.displayUrl) + '">' + escapeHtml(proxy.displayUrl) + '</code></div>' +
                '<div><span class="proxy-cell-label">Status</span><span class="proxy-status proxy-status-' + status + '">' + escapeHtml(statusLabel) + '</span></div>' +
                '<div><span class="proxy-cell-label">Latency</span><span class="proxy-muted">' + escapeHtml(latency) + '</span></div>' +
                '<div><span class="proxy-cell-label">Last tested</span><span class="proxy-muted">' + escapeHtml(testedAt) + '</span></div>' +
                '<div class="proxy-actions"><button class="proxy-btn" data-test="' + proxy.id + '">Test proxy</button><button class="proxy-btn proxy-btn-danger" data-delete="' + proxy.id + '">Delete</button></div>' +
              '</article>';
            }).join('')
          : '<div class="proxy-empty"><div class="proxy-empty-icon"><svg class="icon icon-lg" aria-hidden="true"><use href="#icon-terminal"></use></svg></div><strong>No proxies saved yet</strong><p>Add your first proxy above. Once saved, its health, latency, and latest test time will appear here.</p></div>';

        document.querySelectorAll('[data-test]').forEach(button => button.onclick = () => testProxy(button.dataset.test));
        document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => deleteProxy(button.dataset.delete));
      } catch (error) {
        document.getElementById('proxyMessage').innerText = error.message;
        document.getElementById('htmlProxyHint').textContent = 'Could not refresh saved proxies: ' + error.message;
      }
    }
    async function addProxy(event) {
      event?.preventDefault();
      const form = document.getElementById('proxyForm');
      const button = document.getElementById('btnAddProxy');
      if (button.disabled || !form.reportValidity()) return;
      button.disabled = true;
      document.getElementById('proxyMessage').innerText = 'Saving proxy...';
      try {
        await proxyRequest('/api/v1/proxies', { method: 'POST', body: JSON.stringify({ name: document.getElementById('proxyName').value.trim() || undefined, url: document.getElementById('proxyUrl').value.trim() }) });
        document.getElementById('proxyUrl').value = '';
        document.getElementById('proxyName').value = '';
        document.getElementById('proxyMessage').innerText = 'Proxy saved. Select it in the request builder or HTML generator, then enable proxy routing.';
        await loadProxies();
      } catch (error) { document.getElementById('proxyMessage').innerText = error.message; }
      finally { button.disabled = false; }
    }
    async function importBulkProxies(event) {
      event?.preventDefault();
      const form = document.getElementById('bulkProxyForm');
      const button = document.getElementById('btnImportProxies');
      const input = document.getElementById('bulkProxyText');
      const message = document.getElementById('bulkProxyMessage');
      if (button.disabled || !form.reportValidity()) return;
      button.disabled = true;
      input.readOnly = true;
      message.textContent = 'Importing proxies...';
      try {
        const result = await proxyRequest('/api/v1/proxies/import', { method: 'POST', body: JSON.stringify({ proxies: input.value.trim() }) });
        input.value = '';
        message.textContent = 'Saved ' + result.importedCount + ' proxies with automatic names. Skipped ' + result.skippedCount + ' duplicates.';
        await loadProxies();
      } catch (error) { message.textContent = error.message; }
      finally { button.disabled = false; input.readOnly = false; }
    }
    async function testProxy(id){ document.getElementById('proxyMessage').innerText='Testing proxy…'; try{await proxyRequest('/api/v1/proxies/'+id+'/test',{method:'POST',body:JSON.stringify({})}); document.getElementById('proxyMessage').innerText='Test complete.'; await loadProxies();}catch(e){document.getElementById('proxyMessage').innerText=e.message;} }
    async function deleteProxy(id){ if(!confirm('Delete this proxy?'))return; try{await proxyRequest('/api/v1/proxies/'+id,{method:'DELETE',body:JSON.stringify({})}); await loadProxies();}catch(e){document.getElementById('proxyMessage').innerText=e.message;} }

    /* Next.js Generator Controller */
    async function populateNextjsJobsList() {
      const select = document.getElementById('nextjsJobSelect');
      const apiKey = '${defaultApiKey}';
      try {
        const res = await fetch('/api/v1/jobs?limit=50', { headers: { 'x-api-key': apiKey } });
        const data = await res.json();
        const jobs = data.data || [];
        
        let html = '<option value="">-- Select a scraped job --</option>';
        for (const j of jobs) {
          const name = j.name || j.domain || j.targetUrl;
          const crawled = j.totalPagesCrawled || 0;
          const selected = j.id === currentJobId ? ' selected' : '';
          html += '<option value="' + j.id + '"' + selected + '>' + escapeHtml(name) + ' (' + crawled + ' pages, ' + j.status + ') - ' + j.id + '</option>';
        }
        select.innerHTML = html;
        if (currentJobId) {
          select.value = currentJobId;
          await loadCurrentJobSnapshot();
        }
      } catch (err) {
        console.error('Failed to load jobs list', err);
      }
    }

    function handleNextjsJobSelect() {
      const val = document.getElementById('nextjsJobSelect').value;
      if (val) {
        currentJobId = val;
        loadCurrentJobSnapshot();
      } else {
        resetSitePreview();
        activeConversionId = '';
        currentConversionRecord = null;
        document.getElementById('nextjsResultCard').style.display = 'none';
      }
    }

    function refreshNextjsSnapshot() {
      populateNextjsJobsList();
    }

    function launchNextjsFromPlayground() {
      showView('nextjs');
      if (currentJobId) {
        loadCurrentJobSnapshot();
      }
    }

    async function loadCurrentJobSnapshot() {
      const jobId = document.getElementById('nextjsJobSelect').value || currentJobId;
      if (!jobId) {
        alert('Please select a scraped job first.');
        return;
      }
      currentJobId = jobId;
      resetSitePreview();
      activeConversionId = '';
      currentConversionRecord = null;
      document.getElementById('nextjsResultCard').style.display = 'none';

      const apiKey = '${defaultApiKey}';
      try {
        const res = await fetch(\`/api/v1/jobs/\${jobId}/conversion-preview\`, {
          headers: { 'x-api-key': apiKey }
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || 'Could not load snapshot preview');

        currentPreviewInventory = body.data;

        // Auto-generate safe project name from domain
        const domainSlug = (currentPreviewInventory.domain || 'scraped-app')
          .replace(/[^a-zA-Z0-9]/g, '-')
          .toLowerCase()
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        document.getElementById('nextjsProjectName').value = \`\${domainSlug}-nextjs\`;

        // Update badge
        document.getElementById('nextjsActiveJobBadge').style.display = 'inline-flex';
        document.getElementById('nextjsJobLabel').innerText = \`Active: \${currentPreviewInventory.domain} (\${currentPreviewInventory.totalPages} pages)\`;

        // Render pages checklist
        renderPagesChecklist(currentPreviewInventory.pages);
        document.getElementById('nextjsOptionsContainer').style.display = 'block';

      } catch (err) {
        alert('Failed to load snapshot: ' + err.message);
      }
    }

    function renderPagesChecklist(pages) {
      const tbody = document.getElementById('nextjsPagesList');
      if (!pages || pages.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-muted);">No pages found in this snapshot.</td></tr>';
        return;
      }

      let html = '';
      for (const p of pages) {
        html += \`
          <tr>
            <td style="text-align:center;"><input type="checkbox" class="nextjs-page-chk" value="\${escapeHtml(p.url)}" checked></td>
            <td><code style="color:#38bdf8;font-weight:600;">\${escapeHtml(p.route)}</code></td>
            <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="\${escapeHtml(p.title)}">\${escapeHtml(p.title)}</td>
            <td><span style="font-family:'JetBrains Mono',monospace;color:#94a3b8;font-size:11px;">\${escapeHtml(p.componentName)}</span></td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#64748b;font-size:11px;" title="\${escapeHtml(p.url)}">\${escapeHtml(p.url)}</td>
          </tr>
        \`;
      }
      tbody.innerHTML = html;
    }

    function toggleAllPages(selectAll) {
      document.querySelectorAll('.nextjs-page-chk').forEach(chk => chk.checked = selectAll);
    }

    async function executeNextjsConversion() {
      const btn = document.getElementById('btnStartConversion');
      const projectName = document.getElementById('nextjsProjectName').value.trim() || 'my-nextjs-app';
      const cssStrategy = document.getElementById('nextjsCssStrategy').value;
      const componentExtraction = document.getElementById('nextjsExtractionLevel').value;
      const preserveInteractivity = document.getElementById('nextjsPreserveInteractivity').checked;
      const preserveMetadata = document.getElementById('nextjsPreserveMetadata').checked;

      const selectedPages = Array.from(document.querySelectorAll('.nextjs-page-chk:checked')).map(c => c.value);
      if (selectedPages.length === 0) {
        alert('Please select at least one page to include in the Next.js project.');
        return;
      }

      resetSitePreview();
      activeConversionId = '';
      currentConversionRecord = null;
      const generation = sitePreviewGeneration;
      btn.disabled = true;
      btn.innerHTML = '<span class="icon icon-sm" style="display:inline-block;">⚡</span> Converting...';

      document.getElementById('nextjsProgressCard').style.display = 'block';
      document.getElementById('nextjsResultCard').style.display = 'none';
      renderLiveOperation({ status: 'PENDING', options: { projectName, pages: selectedPages }, stages: [], createdAt: new Date().toISOString() });

      const apiKey = '${defaultApiKey}';

      try {
        const res = await fetch('/api/v1/conversions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey
          },
          body: JSON.stringify({
            jobId: currentJobId,
            options: {
              projectName,
              pages: selectedPages,
              cssStrategy,
              componentExtraction,
              preserveInteractivity,
              preserveMetadata,
              typescript: true
            }
          })
        });

        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || 'Failed to start conversion');

        if (generation !== sitePreviewGeneration) return;
        activeConversionId = body.data.id;
        renderLiveOperation(body.data);
        pollConversionProgress(activeConversionId, generation);

      } catch (err) {
        if (generation !== sitePreviewGeneration) return;
        alert('Error: ' + err.message);
        btn.disabled = false;
        btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-bolt"></use></svg> <span>Convert to Next.js Project</span>';
      }
    }

    async function pollConversionProgress(conversionId, generation = sitePreviewGeneration) {
      const apiKey = '${defaultApiKey}';
      let done = false;

      while (!done && generation === sitePreviewGeneration && conversionId === activeConversionId) {
        await new Promise(r => setTimeout(r, 600));
        if (generation !== sitePreviewGeneration || conversionId !== activeConversionId) return;

        try {
          const res = await fetch(\`/api/v1/conversions/\${conversionId}\`, {
            headers: { 'x-api-key': apiKey }
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error?.message || 'Error polling status');

          if (generation !== sitePreviewGeneration || conversionId !== activeConversionId) return;
          const record = body.data;
          currentConversionRecord = record;

          renderLiveOperation(record);

          if (record.status === 'COMPLETED' || record.status === 'FAILED') {
            done = true;
            const btn = document.getElementById('btnStartConversion');
            btn.disabled = false;
            btn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#icon-bolt"></use></svg> <span>Convert to Next.js Project</span>';

            if (record.status === 'COMPLETED') {
              renderProjectResults(record);
            } else {
              alert('Conversion failed: ' + (record.errorMessage || 'Unknown error'));
            }
          }
        } catch (err) {
          console.error('Polling error', err);
        }
      }
    }

    const operationPhases = [
      { label: 'Discover', stages: ['validate-input', 'load-scrape-snapshot', 'build-page-inventory'] },
      { label: 'Capture', stages: ['resolve-assets', 'analyze-page-structure'] },
      { label: 'Generate', stages: ['identify-shared-components', 'generate-nextjs-files', 'install-or-resolve-dependencies', 'run-static-validation'] },
      { label: 'Package', stages: ['prepare-preview', 'package-project'] }
    ];
    let operationLogText = '';

    function getOperationLogs(record) {
      if (Array.isArray(record?.operationLogs)) return record.operationLogs;
      // Older servers expose only the latest stage snapshot, not an event history.
      return (record?.stages || []).filter(stage => stage.status !== 'pending').map(stage => ({
        timestamp: stage.finishedAt || stage.startedAt,
        stageId: stage.id,
        status: stage.status,
        message: stage.message || stage.label
      }));
    }

    function formatOperationLog(log) {
      const date = new Date(log.timestamp);
      const timestamp = Number.isFinite(date.getTime()) ? date.toISOString() : '—';
      return timestamp + ' [' + (log.stageId || 'conversion') + '] ' + (log.status || '') + ' ' + (log.message || '');
    }

    async function copyOperationLogs() {
      const button = document.getElementById('btnCopyOperationLogs');
      try {
        await navigator.clipboard.writeText(operationLogText);
        button.textContent = 'Copied';
      } catch {
        button.textContent = 'Copy unavailable';
      }
      setTimeout(() => { button.textContent = 'Copy'; }, 1600);
    }

    function renderLiveOperation(record) {
      const stages = Array.isArray(record?.stages) ? record.stages : [];
      const failed = record?.status === 'FAILED';
      const done = record?.status === 'COMPLETED';
      const current = stages.find(stage => stage.id === record?.currentStage);
      const active = stages.find(stage => stage.status === 'failed') || current || stages.find(stage => stage.status === 'running');
      const status = document.getElementById('nextjsOperationStatus');
      status.textContent = failed ? 'Failed' : done ? 'Completed' : record?.status === 'IN_PROGRESS' ? 'In progress' : record?.status === 'PENDING' ? 'Queued' : 'Not started';
      status.className = 'operation-status' + (failed ? ' is-failed' : done ? ' is-done' : record?.status === 'IN_PROGRESS' ? ' is-active' : '');
      document.getElementById('nextjsOperationProject').textContent = record?.options?.projectName || 'Waiting for a conversion';
      document.getElementById('nextjsOperationTaskLabel').textContent = failed ? 'Stopped' : done ? 'Finished' : 'Current task';
      document.getElementById('nextjsOperationTask').textContent = failed ? record.errorMessage || active?.message || 'Conversion failed.' : done ? 'Project packaged' : active?.message || active?.label || 'Waiting for pipeline events';
      document.getElementById('nextjsOperationUrl').textContent = record?.inventory?.targetUrl || record?.options?.pages?.[0] || '';
      const pageCount = record?.inventory?.totalPages;
      const requestedPages = record?.options?.pages?.length;
      document.getElementById('nextjsOperationPages').textContent = Number.isFinite(pageCount) ? pageCount + ' pages' : requestedPages ? requestedPages + ' pages selected' : '? pages';
      const start = new Date(record?.createdAt).getTime();
      const end = done || failed ? new Date(record?.finishedAt || record?.updatedAt).getTime() : Date.now();
      const seconds = Math.max(0, Math.floor((end - start) / 1000));
      document.getElementById('nextjsOperationElapsed').textContent = Number.isFinite(seconds) ? Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's' : '—';
      const completed = stages.filter(stage => stage.status === 'completed').length;
      const percentage = done ? 100 : stages.length ? Math.min(99, Math.round(completed / stages.length * 100)) : 0;
      document.getElementById('nextjsProgressPercent').textContent = percentage + '%';
      document.getElementById('nextjsProgressBar').style.width = percentage + '%';
      const progress = document.getElementById('nextjsOperationProgress');
      progress.setAttribute('aria-valuenow', String(percentage));
      progress.className = 'operation-progress' + (failed ? ' is-failed' : '');
      const phases = document.getElementById('nextjsOperationPhases');
      phases.replaceChildren();
      operationPhases.forEach((phase, index) => {
        const members = stages.filter(stage => phase.stages.includes(stage.id));
        const isFailed = members.some(stage => stage.status === 'failed') || (failed && phase.stages.includes(active?.id));
        const isDone = members.length === phase.stages.length && members.every(stage => stage.status === 'completed');
        const skipped = members.length === phase.stages.length && members.every(stage => stage.status === 'completed' || stage.status === 'skipped') && !isDone;
        const isActive = !failed && !done && members.some(stage => stage.status === 'running');
        const item = document.createElement('li');
        item.className = 'operation-phase' + (isFailed ? ' is-failed' : isDone ? ' is-done' : skipped ? ' is-skipped' : isActive ? ' is-active' : '');
        if (isActive) item.setAttribute('aria-current', 'step');
        const dot = document.createElement('span');
        dot.textContent = isFailed ? '×' : isDone ? '✓' : skipped ? '–' : String(index + 1);
        dot.setAttribute('aria-hidden', 'true');
        item.appendChild(dot);
        item.appendChild(document.createTextNode(phase.label));
        item.setAttribute('aria-label', phase.label + ': ' + (isFailed ? 'failed' : isDone ? 'completed' : skipped ? 'includes skipped stages' : isActive ? 'in progress' : 'pending'));
        phases.appendChild(item);
      });
      const logs = document.getElementById('nextjsOperationLogs');
      const pinned = logs.scrollHeight - logs.scrollTop - logs.clientHeight < 32;
      operationLogText = getOperationLogs(record).map(formatOperationLog).join('\\n');
      if (logs.textContent !== (operationLogText || 'No conversion events yet.')) {
        logs.textContent = operationLogText || 'No conversion events yet.';
        if (pinned) logs.scrollTop = logs.scrollHeight;
      }
      const error = document.getElementById('nextjsOperationError');
      error.hidden = !failed;
      error.textContent = failed ? record.errorMessage || 'The conversion failed. Review the pipeline logs.' : '';
      document.getElementById('nextjsOperationFinished').hidden = !done;
      renderStagesList(stages);
    }

    function renderStagesList(stages) {
      const container = document.getElementById('nextjsStagesList');
      let html = '';

      for (const s of stages) {
        const stageStatus = ['pending', 'running', 'completed', 'failed', 'skipped'].includes(s.status) ? s.status : 'pending';
        const statusClass = \`stage-\${stageStatus}\`;
        let iconHtml = '○';
        if (s.status === 'completed') iconHtml = '✓';
        else if (s.status === 'running') iconHtml = '●';
        else if (s.status === 'failed') iconHtml = '✕';

        const dur = s.durationMs ? \`\${(s.durationMs / 1000).toFixed(1)}s\` : '';

        html += \`
          <div class="stage-item \${statusClass}">
            <div class="stage-left">
              <div class="stage-icon">\${iconHtml}</div>
              <div>
                <strong style="font-size:12px;color:var(--text);">\${escapeHtml(s.label)}</strong>
                \${s.message ? \`<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">\${escapeHtml(s.message)}</div>\` : ''}
              </div>
            </div>
            <div style="font-size:11px;color:var(--text-muted);font-family:'JetBrains Mono',monospace;">\${dur}</div>
          </div>
        \`;
      }

      container.innerHTML = html;
    }

    function renderProjectResults(record) {
      activeConversionId = record.id;
      currentConversionRecord = record;
      configureSitePreview(record);
      document.getElementById('nextjsResultCard').style.display = 'block';
      document.getElementById('nextjsTotalFilesCount').innerText = String(record.totalFilesGenerated || 0);
      explorerOpenFiles = [];
      document.getElementById('explorerSearch').value = '';
      document.getElementById('explorerProjectName').textContent = record.options?.projectName || 'Generated project';
      document.getElementById('explorerProjectSummary').textContent = (record.totalFilesGenerated || 0) + ' files';

      const zipKb = record.zipSizeBytes ? (record.zipSizeBytes / 1024).toFixed(1) + ' KB' : '0 KB';
      document.getElementById('nextjsZipSizeBadge').innerText = zipKb;

      // Validation badge
      const rep = record.validationReport;
      const vBadge = document.getElementById('nextjsValidationBadge');
      if (rep && rep.passed) {
        vBadge.className = 'badge-status';
        vBadge.style.color = '#34d399';
        vBadge.style.background = 'rgba(16,185,129,0.1)';
        vBadge.innerText = \`Validation: Passed (\${rep.checkedFilesCount} files)\`;
      } else {
        vBadge.className = 'badge-status';
        vBadge.style.color = '#f87171';
        vBadge.style.background = 'rgba(239,68,68,0.1)';
        vBadge.innerText = rep ? 'Validation: Issues found' : 'Validation: Not reported';
      }

      const styling = record.stylingReport;
      if (styling && styling.strategy === 'tailwind') {
        vBadge.innerText += \` · Tailwind: \${styling.declarationsConverted}/\${styling.declarationsSeen} CSS declarations converted\`;
        vBadge.title = \`Residual fallback CSS: \${styling.residualCssBytes} bytes. Complex selectors and unsupported declarations remain as CSS to preserve appearance.\`;
      } else {
        vBadge.title = '';
      }

      // Render Tree
      const treeContainer = document.getElementById('nextjsFileTree');
      treeContainer.innerHTML = '';
      if (record.fileTree) {
        treeContainer.appendChild(buildTreeDom(record.fileTree));
      }

      // Choose from the stored tree; older conversions retain their root app/.
      const containsFile = (node, filePath) => !!node && (node.path === filePath || (node.children || []).some(child => containsFile(child, filePath)));
      selectProjectFile(containsFile(record.fileTree, 'src/app/page.tsx') ? 'src/app/page.tsx' : 'app/page.tsx');
    }

    function explorerTreeIcon(kind) {
      const shapes = {
        folder: '<path d="M3 7h6l2-3h4l2 3h4v13H3z"/>',
        file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h4"/>',
        image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 17 6-6 4 4 4-5 4 7"/>',
        chevron: '<path d="m9 5 7 7-7 7"/>'
      };
      return '<svg class="explorer-tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">' + shapes[kind] + '</svg>';
    }

    function buildTreeDom(node, depth = 0) {
      const wrap = document.createElement('div');
      const isRoot = node.type === 'directory' && node.name === 'project';
      if (node.type === 'directory') {
        const children = document.createElement('div');
        children.className = 'explorer-tree-children';
        if (!isRoot) {
          const dirEl = document.createElement('button');
          dirEl.type = 'button';
          dirEl.className = 'tree-node tree-dir explorer-folder-row';
          dirEl.style.paddingLeft = (depth * 16 + 8) + 'px';
          dirEl.setAttribute('aria-expanded', 'true');
          dirEl.innerHTML = explorerTreeIcon('chevron') + explorerTreeIcon('folder') + '<span>' + escapeHtml(node.name) + '</span>';
          dirEl.onclick = () => {
            const expanded = dirEl.getAttribute('aria-expanded') !== 'true';
            dirEl.setAttribute('aria-expanded', String(expanded));
            children.hidden = !expanded;
          };
          wrap.appendChild(dirEl);
        }
        for (const child of node.children || []) children.appendChild(buildTreeDom(child, isRoot ? depth : depth + 1));
        wrap.appendChild(children);
      } else {
        const fileEl = document.createElement('button');
        fileEl.type = 'button';
        fileEl.className = 'tree-node explorer-file-row';
        fileEl.style.paddingLeft = (depth * 16 + 28) + 'px';
        fileEl.dataset.filePath = node.path;
        fileEl.id = 'treeNode-' + node.path.replace(/[^a-zA-Z0-9]/g, '_');
        const kind = /\.(png|jpe?g|gif|webp|avif|ico|svg)$/i.test(node.name) ? 'image' : 'file';
        fileEl.innerHTML = explorerTreeIcon(kind) + '<span>' + escapeHtml(node.name) + '</span>';
        fileEl.title = node.path;
        fileEl.onclick = () => selectProjectFile(node.path);
        wrap.appendChild(fileEl);
      }
      return wrap;
    }

    async function selectProjectFile(filePath) {
      const conversionId = activeConversionId;
      const generation = sitePreviewGeneration;
      currentActiveFilePath = filePath;
      document.getElementById('nextjsActiveFilePath').innerText = filePath.split('/').join(' / ');
      if (!explorerOpenFiles.includes(filePath)) explorerOpenFiles.push(filePath);
      renderExplorerTabs();
      setExplorerContent('// Loading file…', filePath);

      document.querySelectorAll('.tree-node').forEach(el => el.classList.remove('active'));
      const activeEl = document.getElementById('treeNode-' + filePath.replace(/[^a-zA-Z0-9]/g, '_'));
      if (activeEl) activeEl.classList.add('active');

      const apiKey = '${defaultApiKey}';
      try {
        const res = await fetch(\`/api/v1/conversions/\${conversionId}/files/\${filePath}\`, {
          headers: { 'x-api-key': apiKey }
        });
        const body = await res.json();
        if (generation !== sitePreviewGeneration || conversionId !== activeConversionId || filePath !== currentActiveFilePath) return;
        if (res.ok && body.data) {
          if (/\.(png|jpe?g|gif|webp|avif|ico)$/i.test(filePath)) {
            const extension = filePath.split('.').pop().toLowerCase();
            const image = document.createElement('img');
            image.alt = filePath;
            image.src = 'data:image/' + (extension === 'jpg' ? 'jpeg' : extension === 'ico' ? 'x-icon' : extension) + ';base64,' + body.data.content;
            image.style.cssText = 'max-width:100%;max-height:460px;object-fit:contain;';
            document.getElementById('nextjsFileContent').replaceChildren(image);
            document.getElementById('explorerLineNumbers').textContent = '';
            document.getElementById('explorerStatusPath').textContent = filePath;
            document.getElementById('explorerStatusMeta').textContent = 'Image · ' + extension.toUpperCase();
          } else setExplorerContent(body.data.content, filePath);
        } else {
          document.getElementById('nextjsFileContent').innerText = '// Could not preview file (binary or empty)';
        }
      } catch (err) {
        if (generation !== sitePreviewGeneration || conversionId !== activeConversionId || filePath !== currentActiveFilePath) return;
        document.getElementById('nextjsFileContent').innerText = '// Error loading file: ' + err.message;
      }
    }

    function copyCurrentFileContent() {
      const code = document.getElementById('nextjsFileContent').innerText;
      navigator.clipboard.writeText(code);
      alert('File content copied to clipboard!');
    }

    async function downloadNextjsZip() {
      if (!activeConversionId) return;
      const apiKey = '${defaultApiKey}';
      const btn = document.getElementById('btnDownloadZip');
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.7';
      }

      try {
        const downloadUrl = \`/api/v1/conversions/\${activeConversionId}/download?api_key=\${encodeURIComponent(apiKey)}\`;
        const res = await fetch(downloadUrl, {
          headers: {
            'x-api-key': apiKey
          }
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const errMsg = body.error?.message || \`Download failed (Status: \${res.status})\`;
          alert('Download error: ' + errMsg);
          return;
        }

        const blob = await res.blob();
        let filename = 'nextjs-project.zip';
        const disposition = res.headers.get('content-disposition');
        if (disposition) {
          const match = disposition.match(/filename=["']?([^"';]+)["']?/i);
          if (match && match[1]) {
            filename = match[1].trim();
          }
        }

        const objectUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => window.URL.revokeObjectURL(objectUrl), 2000);
      } catch (err) {
        window.location.href = \`/api/v1/conversions/\${activeConversionId}/download?api_key=\${encodeURIComponent(apiKey)}\`;
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      }
    }

    ${renderHtmlGeneratorScript()}
    ${renderExactCloneScript()}

    // Initialize line numbers, code snippet, and locally saved history on load
    setLineNumbers(document.getElementById('editorContent').innerText);
    updateCodeSnippet();
    refreshHistory();
    loadProxies();
  </script>
</body>
</html>`;
}
