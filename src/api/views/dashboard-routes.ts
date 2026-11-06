export const DASHBOARD_ROUTES = {
  playground: '/playground',
  nextjs: '/nextjs-generator',
  html: '/html-generator',
  exact: '/exact-clone',
  proxies: '/proxies',
} as const;

export type DashboardView = keyof typeof DASHBOARD_ROUTES;
