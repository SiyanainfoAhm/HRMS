"use client";

import { PaginationBar } from "@/components/PaginationBar";

type ListPaginationProps = {
  page: number;
  total: number;
  pageSize: number;
  loading?: boolean;
  onPageChange: (nextPage: number) => void;
  position: "top" | "bottom";
};

export function ListPagination({ position, page, total, pageSize, loading, onPageChange }: ListPaginationProps) {
  if (total <= pageSize) return null;

  const bar = (
    <PaginationBar page={page} total={total} pageSize={pageSize} loading={loading} onPageChange={onPageChange} />
  );

  if (position === "top") {
    return <div className="mb-4 lg:hidden">{bar}</div>;
  }

  return <div className="mt-4 border-t border-brand-border pt-4 lg:mt-5">{bar}</div>;
}
