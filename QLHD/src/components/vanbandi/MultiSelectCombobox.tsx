import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export interface Option {
  label: string;
  value: string;
}

interface MultiSelectComboboxProps {
  options: Option[];
  value: string[];
  placeholder?: string;
  onChange: (value: string[]) => void;
}

export function MultiSelectCombobox({
  options,
  value,
  placeholder,
  onChange,
}: MultiSelectComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const lastScrollTop = React.useRef(0);

  const selectedLabels = React.useMemo(
    () => options.filter((o) => value.includes(o.value)).map((o) => o.label),
    [options, value]
  );

  const handleToggle = (val: string) => {
    if (scrollRef.current) lastScrollTop.current = scrollRef.current.scrollTop;

    const next = value.includes(val)
      ? value.filter((v) => v !== val)
      : [...value, val];

    onChange(next);

    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = lastScrollTop.current;
      }
    });
  };

  const displayText = React.useMemo(() => {
    if (selectedLabels.length === 0) return placeholder || "Chọn";
    const head = selectedLabels.slice(0, 2).join(", ");
    const rest = selectedLabels.length - 2;
    return rest > 0 ? `${head} +${rest}` : head;
  }, [selectedLabels, placeholder]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between gap-2"
          title={selectedLabels.join(", ")}
        >
          <span className="flex-1 min-w-0 text-left">
            <span className="block truncate">{displayText}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-full p-0"
        onOpenAutoFocus={(e) => e.preventDefault()} // tránh nhảy focus
      >
        <Command
          className="max-h-60 overflow-y-auto overscroll-contain"
          // chặn wheel nổi bọt để không cuộn body
          onWheelCapture={(e) => e.stopPropagation()}
          // chặn touch scroll nổi bọt (mobile)
          onTouchMoveCapture={(e) => e.stopPropagation()}
        >
          <CommandInput placeholder="Tìm kiếm..." />
          <CommandEmpty>Không tìm thấy.</CommandEmpty>
          {/* CommandList có overflow scroll */}
          <CommandList ref={scrollRef} className="max-h-60 overflow-y-auto">
            <CommandGroup>
              <CommandItem
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => {
                  if (value.length === options.length) {
                    // Nếu đã chọn hết → bỏ chọn hết
                    onChange([]);
                  } else {
                    // Nếu chưa chọn hết → chọn tất cả
                    onChange(options.map((o) => o.value));
                  }
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value.length === options.length
                      ? "opacity-100"
                      : "opacity-0"
                  )}
                />
                Chọn tất cả
              </CommandItem>

              {options.map((option) => {
                const isSelected = value.includes(option.value);
                return (
                  <CommandItem
                    key={option.value}
                    onMouseDown={(e) => e.preventDefault()} // giữ scroll
                    onSelect={() => handleToggle(option.value)}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        isSelected ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {option.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
