"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type SearchableSelectOption = {
  value: string;
  label: string;
};

type SearchableSelectProps = {
  name: string;
  options: SearchableSelectOption[];
  placeholder?: string;
  emptyLabel?: string;
  searchPlaceholder?: string;
  className?: string;
  defaultValue?: string;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function SearchableSelect({
  name,
  options,
  placeholder = "Chọn một giá trị",
  emptyLabel = "Không có dữ liệu",
  searchPlaceholder = "Tìm kiếm...",
  className,
  defaultValue = "",
}: SearchableSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState(defaultValue);

  const selectedOption = useMemo(() => {
    return options.find((option) => option.value === selectedValue);
  }, [options, selectedValue]);

  const filteredOptions = useMemo(() => {
    const keyword = normalizeText(query);

    if (!keyword) return options;

    return options.filter((option) =>
      normalizeText(option.label).includes(keyword),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      window.setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);
    }
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={cn("relative", open && "z-[9999]", className)}
    >
      <input type="hidden" name={name} value={selectedValue} />

      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={cn(
          "flex h-11 w-full items-center justify-between rounded-2xl border border-input bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm transition",
          "hover:bg-secondary/50 focus:outline-none focus:ring-4 focus:ring-ring/15",
        )}
        onClick={() => {
          setOpen((value) => !value);
          setQuery("");
        }}
      >
        <span
          className={cn(
            "truncate text-left",
            !selectedOption && "font-normal text-muted-foreground",
          )}
        >
          {selectedOption?.label ?? placeholder}
        </span>

        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-[9999] mb-2 w-full overflow-hidden rounded-2xl border bg-card text-card-foreground shadow-xl">
          <div
            id={listboxId}
            role="listbox"
            className="max-h-72 space-y-1 overflow-y-auto p-1.5"
          >
            <button
              type="button"
              role="option"
              aria-selected={selectedValue === ""}
              className={cn(
                "relative flex w-full items-center rounded-xl py-2.5 pl-9 pr-3 text-left text-sm transition",
                selectedValue === ""
                  ? "bg-secondary text-secondary-foreground"
                  : "text-foreground hover:bg-secondary/70",
              )}
              onClick={() => {
                setSelectedValue("");
                setOpen(false);
                setQuery("");
              }}
            >
              <span className="absolute left-3 flex h-4 w-4 items-center justify-center">
                {selectedValue === "" ? <Check className="h-4 w-4" /> : null}
              </span>

              <span className="truncate">Không chỉ định - TBP xác nhận</span>
            </button>

            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = selectedValue === option.value;

                return (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      "relative flex w-full items-center rounded-xl py-2.5 pl-9 pr-3 text-left text-sm transition",
                      isSelected
                        ? "bg-secondary text-secondary-foreground"
                        : "text-foreground hover:bg-secondary/70",
                    )}
                    onClick={() => {
                      setSelectedValue(option.value);
                      setOpen(false);
                      setQuery("");
                    }}
                  >
                    <span className="absolute left-3 flex h-4 w-4 items-center justify-center">
                      {isSelected ? <Check className="h-4 w-4" /> : null}
                    </span>

                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                {emptyLabel}
              </div>
            )}
          </div>

          <div className="border-t border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                className="flex h-10 w-full rounded-xl border border-input bg-background pl-9 pr-9 text-sm outline-none transition placeholder:text-muted-foreground focus:ring-4 focus:ring-ring/15"
              />

              {query && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                  onClick={() => {
                    setQuery("");
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Xóa từ khóa tìm kiếm"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
