import type { Dispatch, SetStateAction } from "react";
import type { PageParamState, PaginatedResponse } from "../../constant/interfaces";

type Props<T> = {
  data: PaginatedResponse<T>;
  param: PageParamState;
  setParam: Dispatch<SetStateAction<PageParamState>>;
  showStatistics?: boolean;
};

export const Pagination = <T,>({
  data,
  param,
  setParam,
  showStatistics = false,
}: Props<T>) => {
  if (data.count === 0) {
    return null;
  }

  const changePage = (pageNo: number) =>
    setParam((previous) => ({
      ...previous,
      pageNo,
    }));

  const canGoPrevious = param.pageNo > 1;
  const canGoNext = param.pageNo < data.totalPages;

  return (
    <div className="app-pagination">
      <div className="app-pagination-size">
        <span>Rows per page</span>
        <select
          className="form-select form-select-sm"
          value={param.limit}
          onChange={(event) =>
            setParam((previous) => ({
              ...previous,
              pageNo: 1,
              limit: Number(event.target.value),
            }))
          }
        >
          {[5, 10, 20, 50].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      <div className="app-pagination-controls">
        <button
          className="btn btn-sm btn-outline-secondary app-pagination-icon"
          disabled={!canGoPrevious}
          onClick={() => changePage(1)}
          aria-label="Go to first page"
          title="First page"
        >
          <i className="ri-skip-left-line" aria-hidden="true" />
        </button>
        <button
          className="btn btn-sm btn-outline-secondary app-pagination-icon"
          disabled={!canGoPrevious}
          onClick={() => changePage(param.pageNo - 1)}
          aria-label="Go to previous page"
          title="Previous page"
        >
          <i className="ri-arrow-left-s-line" aria-hidden="true" />
        </button>
        {data.pagination.map((page) => (
          <button
            key={page}
            className={`btn btn-sm app-pagination-page ${page === param.pageNo ? "btn-primary" : "btn-outline-secondary"}`}
            onClick={() => changePage(page)}
            aria-label={`Go to page ${page}`}
            aria-current={page === param.pageNo ? "page" : undefined}
          >
            {page}
          </button>
        ))}
        <button
          className="btn btn-sm btn-outline-secondary app-pagination-icon"
          disabled={!canGoNext}
          onClick={() => changePage(param.pageNo + 1)}
          aria-label="Go to next page"
          title="Next page"
        >
          <i className="ri-arrow-right-s-line" aria-hidden="true" />
        </button>
        <button
          className="btn btn-sm btn-outline-secondary app-pagination-icon"
          disabled={!canGoNext}
          onClick={() => changePage(data.totalPages)}
          aria-label="Go to last page"
          title="Last page"
        >
          <i className="ri-skip-right-line" aria-hidden="true" />
        </button>
      </div>

      {showStatistics ? (
        <p className="app-pagination-stats mb-0 small text-body-secondary">
          Page {param.pageNo} of {data.totalPages} · {data.count} total records
        </p>
      ) : null}
    </div>
  );
};
