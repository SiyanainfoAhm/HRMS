export const DEFAULT_PAGE_SIZE = 25;

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;

export const MAX_PAGE_SIZE = 100;

export const SEARCH_DEBOUNCE_MS = 300;

export type PaginationMeta = {
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
};

export function emptyPaginationMeta(perPage = DEFAULT_PAGE_SIZE): PaginationMeta {
  return {
    current_page: 1,
    per_page: perPage,
    total: 0,
    last_page: 1,
  };
}

export function buildPaginatedQuery(params: {
  page: number;
  perPage: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  filters?: Record<string, string | number | boolean | undefined>;
}): string {
  const q = new URLSearchParams();
  q.set("page", String(Math.max(1, params.page)));
  q.set("per_page", String(Math.min(MAX_PAGE_SIZE, Math.max(1, params.perPage))));
  if (params.search?.trim()) q.set("search", params.search.trim());
  if (params.sortBy) q.set("sort_by", params.sortBy);
  if (params.sortDir) q.set("sort_dir", params.sortDir);
  if (params.filters) {
    for (const [key, value] of Object.entries(params.filters)) {
      if (value !== undefined && value !== "") q.set(key, String(value));
    }
  }
  return q.toString();
}
