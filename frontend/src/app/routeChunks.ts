import { lazy } from 'react';

export const routeChunkImporters = {
  ledger: () => import('../pages/DataLedgerPage/DataLedgerPage'),
  ai: () => import('../pages/AIAssistantPage/AIAssistantPage'),
  about: () => import('../pages/AboutPage/AboutPage'),
  report: () => import('../pages/ReportPage/ReportPage'),
};

export type RouteChunkKey = keyof typeof routeChunkImporters;

export const routeChunkCache = new Map<RouteChunkKey, Promise<unknown>>();

export const preloadChunk = <TKey extends string, TResult>(
  cache: Map<TKey, Promise<TResult>>,
  importers: Record<TKey, () => Promise<TResult>>,
  key: TKey,
): Promise<TResult> => {
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const next = importers[key]();
  cache.set(key, next);
  return next;
};

export const preloadRouteChunk = (key: RouteChunkKey): Promise<unknown> =>
  preloadChunk(routeChunkCache, routeChunkImporters, key);

export const LazyDataLedgerPage = lazy(routeChunkImporters.ledger);
export const LazyAIAssistantPage = lazy(routeChunkImporters.ai);
export const LazyAboutPage = lazy(routeChunkImporters.about);
export const LazyReportPage = lazy(routeChunkImporters.report);
