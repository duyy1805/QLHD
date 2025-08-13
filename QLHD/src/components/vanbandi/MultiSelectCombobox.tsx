import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
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
  value: string[]; // Mảng các giá trị đã chọn
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

  const selectedLabels = options
    .filter((opt) => value.includes(opt.value))
    .map((opt) => opt.label);

  const handleToggle = (val: string) => {
    if (value.includes(val)) onChange(value.filter((v) => v !== val));
    else onChange([...value, val]);
  };

  const displayText = React.useMemo(() => {
    if (selectedLabels.length === 0) return placeholder || "Chọn";
    // Hiển thị tối đa 2 nhãn, phần còn lại gộp thành +N
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
          // title hiển thị full danh sách khi hover
          title={selectedLabels.join(", ")}
        >
          <span className="flex-1 min-w-0 text-left">
            {/* tránh tràn chữ */}
            <span className="block truncate">{displayText}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0 max-h-60 overflow-y-auto">
        <Command>
          <CommandInput placeholder="Tìm kiếm..." />
          <CommandEmpty>Không tìm thấy.</CommandEmpty>
          <CommandGroup>
            {options.map((option) => {
              const isSelected = value.includes(option.value);
              return (
                <CommandItem
                  key={option.value}
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
