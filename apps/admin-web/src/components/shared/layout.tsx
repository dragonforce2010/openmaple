import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { Children, useEffect, useState } from "react";
import { useI18n } from "../../appConfig";
import { Icon, ModalLayer } from "../../ui";

export function Crumb({ parts }: { parts: Array<{ label: string; icon?: string; onClick?: () => void }> }) {
  return (
    <div className="breadcrumb">
      {parts.map((part, index) => {
        const last = index === parts.length - 1;
        return (
          <span key={index}>
            {index ? <span className="sep">/</span> : null}
            {last ? (
              <span className="cur">{part.label}</span>
            ) : (
              <button onClick={part.onClick}>{part.icon ? <Icon name={part.icon} size={14} /> : null}{part.label}</button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export const defaultPageSize = 10;

export type PaginationState<T> = {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  start: number;
  end: number;
  setPage: (page: number) => void;
  pageItems: T[];
};

export function usePagination<T>(items: T[], options: { pageSize?: number; resetKey?: string } = {}) {
  const pageSize = options.pageSize ?? defaultPageSize;
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => {
    setPage(1);
  }, [options.resetKey, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(current, 1), pageCount));
  }, [pageCount]);

  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, items.length);
  return {
    page,
    pageCount,
    pageSize,
    total: items.length,
    start,
    end,
    setPage: (nextPage: number) => setPage(nextPage),
    pageItems: items.slice(start, end)
  };
}

export function PaginationControls<T>({ page, pageCount, pageSize, total, start, end, setPage, className = "" }: PaginationState<T> & { className?: string }) {
  const { language } = useI18n();
  if (total <= pageSize) return null;
  const previousLabel = language === "zh" ? "上一页" : "Previous";
  const nextLabel = language === "zh" ? "下一页" : "Next";
  return (
    <div className={`pagination-footer ${className}`.trim()}>
      <span className="pagination-range">
        {language === "zh" ? <>第 <strong>{start + 1}-{end}</strong> 条，共 <strong>{total}</strong> 条</> : <><strong>{start + 1}-{end}</strong> of <strong>{total}</strong></>}
      </span>
      <div className="pagination-actions">
        <button aria-label={previousLabel} title={previousLabel} onClick={() => setPage(page - 1)} disabled={page <= 1}>
          <ChevronLeft size={15} />
        </button>
        <span>{page} / {pageCount}</span>
        <button aria-label={nextLabel} title={nextLabel} onClick={() => setPage(page + 1)} disabled={page >= pageCount}>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

export function DataTable({
  headers,
  children,
  pageSize = defaultPageSize,
  loading = false,
  loadingLabel
}: {
  headers: string[];
  children: React.ReactNode;
  pageSize?: number;
  loading?: boolean;
  loadingLabel?: string;
}) {
  const { language } = useI18n();
  const rows = Children.toArray(children);
  const pagination = usePagination(rows, { pageSize, resetKey: rows.map((row) => String((row as { key?: unknown }).key ?? "")).join("|") });
  const label = loadingLabel ?? (language === "zh" ? "加载中…" : "Loading...");
  return (
    <div className="data-table-wrap">
      <div className="card">
        <table className="data-table">
          <thead><tr>{headers.map((header, index) => <th className={header ? undefined : "actions-head"} key={`${header}:${index}`}>{header}</th>)}</tr></thead>
          <tbody>
            {loading ? (
              <tr className="table-loading-row">
                <td colSpan={headers.length}>
                  <span className="table-loading" role="status" aria-live="polite" aria-busy="true">
                    <span className="spin-dot" /> {label}
                  </span>
                </td>
              </tr>
            ) : pagination.pageItems}
          </tbody>
        </table>
      </div>
      {loading ? null : <PaginationControls {...pagination} />}
    </div>
  );
}

export function ListLoadingState({ label }: { label?: string }) {
  const { language } = useI18n();
  return (
    <div className="list-loading-state" role="status" aria-live="polite" aria-busy="true">
      <span className="boot-orbit"><i /><i /><i /></span>
      <b>{label ?? (language === "zh" ? "加载列表中…" : "Loading list...")}</b>
    </div>
  );
}

export function PageFrame({ title, sub, action, crumb, children }: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; crumb?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="page-frame">
      {crumb}
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          {sub ? <div className="sub">{sub}</div> : null}
        </div>
        {action ? <div className="action-row">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function ModalShell({ title, onClose, children, wide, className }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean; className?: string }) {
  const { language } = useI18n();
  const closeLabel = language === "zh" ? "关闭" : "Close";
  const modalClassName = `${wide ? "modal lg" : "modal"}${className ? ` ${className}` : ""}`;
  return (
    <ModalLayer onClose={onClose}>
      <div className={modalClassName} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <b>{title}</b>
          <button className="x" onClick={onClose} aria-label={closeLabel}><Icon name="i-x" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </ModalLayer>
  );
}
