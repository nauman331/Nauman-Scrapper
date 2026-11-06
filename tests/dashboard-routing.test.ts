import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/api/server.js';
import { DASHBOARD_ROUTES } from '../src/api/views/dashboard-routes.js';
import { renderPlaygroundHtml } from '../src/api/views/playground.html.js';

describe('Dashboard section routing', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildServer(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  it.each(Object.values(DASHBOARD_ROUTES))('serves %s directly without redirecting to playground', async (route) => {
    const response = await app.inject({ method: 'GET', url: route });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.headers.location).toBeUndefined();
    expect(response.body).toContain('dashboardViewFromPath');
  });
  it('uses real links, History API navigation, refresh initialization and back/forward handling', () => {
    const html = renderPlaygroundHtml();
    for (const route of Object.values(DASHBOARD_ROUTES)) expect(html).toContain(`href="${route}"`);
    expect(html).toContain('window.history.pushState');
    expect(html).toContain("window.addEventListener('popstate'");
    expect(html).toContain("window.addEventListener('DOMContentLoaded', () => showView(dashboardViewFromPath(), false))");
    expect(html).toContain("nav.setAttribute('aria-current', 'page')");
  });
});
