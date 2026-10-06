import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";
import { Field, Input } from "./Field";
import {
  calculateSearchableSelectPopupGeometry,
  filterSearchableSelectOptions,
  findSearchableSelectBoundaryIndex,
  findSearchableSelectActiveIndex,
  getSearchableSelectAriaState,
  getSearchableSelectOptionId,
  isSearchableSelectPointerOutside,
  isSearchableSelectTouchScroll,
  isSearchableSelectOptionSelectable,
  isCurrentSearchableSelectRequest,
  resolveSearchableSelectOptions,
  shouldCommitSearchableSelectSelection,
  shouldUseSearchableSelectBoundaryNavigation,
  stepSearchableSelectActiveIndex,
} from "./searchable-select-model";
import styles from "./SearchableSelect.module.css";

export interface SearchableSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface SearchableSelectBaseProps {
  id?: string;
  /** When provided, the selected value is included in FormData through a hidden input. */
  name?: string;
  label: string;
  hint?: string;
  required?: boolean;
  value: string;
  options: readonly SearchableSelectOption[];
  searchDebounceMs?: number;
  loadingMessage?: string;
  searchErrorMessage?: string;
  placeholder: string;
  emptyMessage: string;
  error?: string;
  disabled?: boolean;
  clearLabel?: string;
  onChange(value: string): void;
}

export type SearchableSelectProps = SearchableSelectBaseProps & (
  | {
    /** Local filtering is the default; use remote mode for permission-scoped records. */
    searchMode?: "local";
    onSearch?: never;
    selectedOption?: never;
  }
  | {
    /** Remote mode renders only results returned by the permission-checked server query. */
    searchMode: "remote";
    /** The server must authorize and bound every query. */
    onSearch: (query: string) => Promise<readonly SearchableSelectOption[]>;
    /** Keeps the selected label available when it is not in the current server result page. */
    selectedOption?: SearchableSelectOption | null;
  }
);

type RemoteSearchState = {
  query: string;
  status: "idle" | "loading" | "ready" | "error";
  options: readonly SearchableSelectOption[];
};

function isSearchableSelectOptionShape(value: unknown): value is SearchableSelectOption {
  if (!value || typeof value !== "object") return false;
  const option = value as Partial<SearchableSelectOption>;
  return typeof option.value === "string" && typeof option.label === "string" &&
    (option.description === undefined || typeof option.description === "string") &&
    (option.disabled === undefined || typeof option.disabled === "boolean");
}

/** Searchable, keyboard-operable choice list with viewport-aware portal placement. */
export function SearchableSelect({
  id: providedId,
  name,
  label,
  hint,
  required = false,
  value,
  options,
  searchMode = "local",
  onSearch,
  selectedOption,
  searchDebounceMs = 180,
  loadingMessage = "Searching…",
  searchErrorMessage = "Options could not be loaded. Edit the search to try again.",
  placeholder,
  emptyMessage,
  error,
  disabled = false,
  clearLabel,
  onChange,
}: SearchableSelectProps) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const listboxId = `${id}-listbox`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteState, setRemoteState] = useState<RemoteSearchState>({ query: "", status: "idle", options: [] });
  const [activeIndex, setActiveIndex] = useState(0);
  const [popupGeometry, setPopupGeometry] = useState<{ left: number; width: number; top: number; maxHeight: number; placement: "above" | "below" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const choiceShellRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | null>(null);
  const touchPointerInsidePopup = useRef(false);
  const touchPointerStart = useRef<{ x: number; y: number } | null>(null);
  const touchPointerMoved = useRef(false);
  const requestId = useRef(0);
  const searchCallback = useRef(onSearch);
  const selectedOptionCache = useRef<SearchableSelectOption | null>(null);
  searchCallback.current = onSearch;
  const normalizedQuery = query.trim();
  const currentRemoteState = remoteState.query === normalizedQuery ? remoteState : null;
  const localFiltered = useMemo(
    () => searchMode === "local" ? filterSearchableSelectOptions(options, query) : [],
    [options, query, searchMode],
  );
  const filtered = resolveSearchableSelectOptions(
    searchMode === "remote"
      ? currentRemoteState?.status === "ready" ? currentRemoteState.options : []
      : localFiltered,
    query,
    searchMode,
  );
  const boundedActiveIndex = activeIndex < 0 ? -1 : Math.min(activeIndex, Math.max(0, filtered.length - 1));
  const safeActiveIndex = boundedActiveIndex >= 0 && filtered[boundedActiveIndex] && isSearchableSelectOptionSelectable(filtered[boundedActiveIndex])
    ? boundedActiveIndex
    : findSearchableSelectBoundaryIndex(filtered, "first");
  const activeOption = filtered[safeActiveIndex];
  const ariaState = getSearchableSelectAriaState(listboxId, filtered.length, safeActiveIndex, open);
  const selected = (searchMode === "remote" && selectedOption?.value === value ? selectedOption : null) ||
    options.find((option) => option.value === value) ||
    (selectedOptionCache.current?.value === value ? selectedOptionCache.current : null);
  const displayedValue = open ? query : selected?.label || "";

  useEffect(() => {
    if (value !== selectedOptionCache.current?.value) selectedOptionCache.current = null;
  }, [value]);

  useEffect(() => {
    if (searchMode !== "remote") {
      requestId.current += 1;
      return;
    }
    if (typeof searchCallback.current !== "function") {
      requestId.current += 1;
      setRemoteState({ query: normalizedQuery, status: "error", options: [] });
      return;
    }
    if (!open || disabled) {
      requestId.current += 1;
      return;
    }

    const currentRequestId = ++requestId.current;
    let active = true;
    setRemoteState({ query: normalizedQuery, status: "loading", options: [] });
    const timer = window.setTimeout(() => {
      Promise.resolve()
        .then(() => searchCallback.current?.(normalizedQuery))
        .then((result) => {
          if (!active || !isCurrentSearchableSelectRequest(requestId.current, currentRequestId, query.trim(), normalizedQuery)) return;
          if (!Array.isArray(result) || result.some((option) => !isSearchableSelectOptionShape(option))) {
            throw new Error("Invalid searchable select response");
          }
          setRemoteState({ query: normalizedQuery, status: "ready", options: result });
          setActiveIndex(findSearchableSelectBoundaryIndex(result, "first"));
        })
        .catch(() => {
          if (!active || !isCurrentSearchableSelectRequest(requestId.current, currentRequestId, query.trim(), normalizedQuery)) return;
          setRemoteState({ query: normalizedQuery, status: "error", options: [] });
          setActiveIndex(-1);
        });
    }, normalizedQuery ? Math.max(0, searchDebounceMs) : 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      if (requestId.current === currentRequestId) requestId.current += 1;
    };
  }, [disabled, open, normalizedQuery, searchDebounceMs, searchMode]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const anchor = inputRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportHeight = viewport?.height || window.innerHeight;
      const viewportWidth = viewport?.width || window.innerWidth;
      setPopupGeometry(calculateSearchableSelectPopupGeometry(
        { top: anchor.top, bottom: anchor.bottom, left: anchor.left, width: anchor.width },
        { top: viewportTop, bottom: viewportTop + viewportHeight, left: viewportLeft, right: viewportLeft + viewportWidth },
      ));
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !activeOption) return;
    document.getElementById(getSearchableSelectOptionId(listboxId, safeActiveIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [open, safeActiveIndex, activeOption, listboxId]);

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      if (!isSearchableSelectPointerOutside(event.target, choiceShellRef.current, popupRef.current)) return;
      clearCloseTimer();
      setOpen(false);
      setQuery("");
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [open]);

  function clearCloseTimer() {
    if (closeTimer.current === null) return;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  function closeAfterBlur() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setQuery("");
      closeTimer.current = null;
    }, 120);
  }

  function onPopupPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    clearCloseTimer();
    touchPointerInsidePopup.current = true;
    touchPointerStart.current = { x: event.clientX, y: event.clientY };
    touchPointerMoved.current = false;
  }

  function onPopupPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = touchPointerStart.current;
    if (event.pointerType !== "touch" || !start || touchPointerMoved.current) return;
    touchPointerMoved.current = isSearchableSelectTouchScroll(start, { x: event.clientX, y: event.clientY });
  }

  function onPopupPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    const shouldClose = !touchPointerMoved.current && document.activeElement !== inputRef.current;
    touchPointerInsidePopup.current = false;
    touchPointerStart.current = null;
    touchPointerMoved.current = false;
    if (shouldClose) closeAfterBlur();
  }

  function onPopupPointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    touchPointerInsidePopup.current = false;
    touchPointerStart.current = null;
    touchPointerMoved.current = false;
  }

  function choose(option: SearchableSelectOption) {
    if (!isSearchableSelectOptionSelectable(option)) return;
    clearCloseTimer();
    if (searchMode === "remote") selectedOptionCache.current = option;
    onChange(option.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const canNavigateBoundary = shouldUseSearchableSelectBoundaryNavigation(
      event.key,
      query,
      event.nativeEvent.isComposing,
    );
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => stepSearchableSelectActiveIndex(
        current, filtered.length, "next", filtered.map((option) => option.disabled === true),
      ));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => stepSearchableSelectActiveIndex(
        current, filtered.length, "previous", filtered.map((option) => option.disabled === true),
      ));
    } else if (canNavigateBoundary && event.key === "Home" && open && filtered.length) {
      event.preventDefault();
      setActiveIndex(findSearchableSelectBoundaryIndex(filtered, "first"));
    } else if (canNavigateBoundary && event.key === "End" && open && filtered.length) {
      event.preventDefault();
      setActiveIndex(findSearchableSelectBoundaryIndex(filtered, "last"));
    } else if (shouldCommitSearchableSelectSelection(
      event.nativeEvent.key,
      event.nativeEvent.isComposing,
      event.nativeEvent.keyCode,
    ) && open && activeOption) {
      event.preventDefault();
      choose(activeOption);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <Field id={id} label={label} hint={hint} required={required} error={error} className={styles.field}>
      {(control) => (
        <div className={styles.choiceShell} ref={choiceShellRef}>
          {name ? <input type="hidden" name={name} value={value} disabled={disabled} /> : null}
          <Input
            {...control}
            ref={inputRef}
            className={clearLabel && value ? styles.choiceInputHasClear : undefined}
            role="combobox"
            aria-autocomplete="list"
            aria-busy={searchMode === "remote" && currentRemoteState?.status === "loading" || undefined}
            aria-expanded={open}
            aria-controls={ariaState.controls}
            aria-activedescendant={ariaState.activeDescendant}
            aria-required={required || undefined}
            autoComplete="off"
            value={displayedValue}
            placeholder={placeholder}
            disabled={disabled}
            onFocus={() => {
              clearCloseTimer();
              setOpen(true);
              setQuery("");
              setActiveIndex(searchMode === "remote" ? -1 : findSearchableSelectActiveIndex(options, value));
            }}
            onBlur={() => { if (!touchPointerInsidePopup.current) closeAfterBlur(); }}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const nextQuery = event.currentTarget.value;
              setQuery(nextQuery);
              setOpen(true);
              setActiveIndex(searchMode === "remote"
                ? -1
                : findSearchableSelectActiveIndex(filterSearchableSelectOptions(options, nextQuery), ""));
              if (value) onChange("");
            }}
            onKeyDown={onKeyDown}
          />
          {clearLabel && value && !disabled ? (
            <Button className={styles.clearChoice} type="button" variant="quiet" size="compact" aria-label={clearLabel} onClick={() => {
              onChange("");
              setQuery("");
              setOpen(false);
            }}>
              Clear
            </Button>
          ) : null}
          {open && !disabled && popupGeometry ? createPortal(
            <div
              className={styles.popup}
              data-placement={popupGeometry.placement}
              style={{ left: popupGeometry.left, top: popupGeometry.top, width: popupGeometry.width, maxHeight: popupGeometry.maxHeight }}
              onPointerDownCapture={onPopupPointerDown}
              onPointerMoveCapture={onPopupPointerMove}
              onPointerUpCapture={onPopupPointerUp}
              onPointerCancelCapture={onPopupPointerCancel}
              ref={popupRef}
            >
              <div id={listboxId} className={styles.listbox} role="listbox" aria-label={label}
                aria-busy={searchMode === "remote" && currentRemoteState?.status === "loading" || undefined}>
                {filtered.map((option, index) => (
                  <div
                    key={option.value}
                    id={getSearchableSelectOptionId(listboxId, index)}
                    className={styles.option}
                    role="option"
                    aria-selected={option.value === value}
                    aria-disabled={option.disabled || undefined}
                    data-active={index === safeActiveIndex || undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }}
                    onClick={() => choose(option)}
                  >
                    <span className={styles.optionCopy}>
                      <span className={styles.optionLabel}>{option.label}</span>
                      {option.description ? <span className={styles.optionDetail}>{option.description}</span> : null}
                    </span>
                    {option.value === value ? <span aria-hidden="true" className={styles.optionCheck}>✓</span> : null}
                  </div>
                ))}
              </div>
              {searchMode === "remote" && currentRemoteState?.status === "loading"
                ? <div className={styles.noResults} data-state="loading" role="status" aria-live="polite">{loadingMessage}</div>
                : null}
              {searchMode === "remote" && currentRemoteState?.status === "error"
                ? <div className={styles.noResults} data-state="error" role="alert">{searchErrorMessage}</div>
                : null}
              {searchMode === "remote" && currentRemoteState?.status === "ready" && !filtered.length
                ? <div className={styles.noResults} data-state="empty" role="status" aria-live="polite">{emptyMessage}</div>
                : null}
              {searchMode === "local" && !filtered.length
                ? <div className={styles.noResults} data-state="empty" role="status">{emptyMessage}</div>
                : null}
            </div>, document.body,
          ) : null}
        </div>
      )}
    </Field>
  );
}
