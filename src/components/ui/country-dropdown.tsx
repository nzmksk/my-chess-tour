"use client";

// Searchable country dropdown built on shadcn Popover + Command, with circle
// flags from react-circle-flags and ISO data from country-data-list.
// Adapted from https://shadcn-country-dropdown.vercel.app

import * as React from "react";
import { countries } from "country-data-list";
import { CircleFlag } from "react-circle-flags";
import { CheckIcon, ChevronDown, Globe } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export interface Country {
  alpha2: string;
  alpha3: string;
  name: string;
  emoji?: string;
  countryCallingCodes?: string[];
  currencies?: string[];
  ioc?: string;
  languages?: string[];
  status?: string;
}

interface CountryDropdownProps {
  options?: Country[];
  onChange?: (country: Country) => void;
  defaultValue?: string;
  disabled?: boolean;
  placeholder?: string;
  slim?: boolean;
  className?: string;
}

const DEFAULT_OPTIONS: Country[] = (countries.all as Country[])
  .filter((c) => c.status === "assigned" && c.alpha2 && c.name)
  .sort((a, b) => a.name.localeCompare(b.name));

export function CountryDropdown({
  options = DEFAULT_OPTIONS,
  onChange,
  defaultValue,
  disabled = false,
  placeholder = "Select a country",
  slim = false,
  className,
}: CountryDropdownProps) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Country | undefined>(
    undefined,
  );

  // Sync selection with defaultValue (alpha-3) whenever it or the options change.
  React.useEffect(() => {
    if (defaultValue) {
      const match = options.find((c) => c.alpha3 === defaultValue);
      setSelected(match);
    } else {
      setSelected(undefined);
    }
  }, [defaultValue, options]);

  const handleSelect = (country: Country) => {
    setSelected(country);
    onChange?.(country);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-auto justify-between px-4 py-2 font-normal",
            slim ? "w-auto" : "w-full",
            className,
          )}
        >
          {selected ? (
            <span className="flex items-center gap-2 overflow-hidden">
              <CircleFlag
                countryCode={selected.alpha2.toLowerCase()}
                height={20}
                className="size-5 shrink-0"
              />
              {!slim && (
                <span className="overflow-hidden text-ellipsis whitespace-nowrap">
                  {selected.name}
                </span>
              )}
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Globe className="size-4 opacity-60" />
              {!slim && <span>{placeholder}</span>}
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-(--radix-popover-trigger-width) p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search country..." />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {options.map((country) => (
                <CommandItem
                  key={country.alpha3}
                  value={country.name}
                  onSelect={() => handleSelect(country)}
                  className="gap-2"
                >
                  <CircleFlag
                    countryCode={country.alpha2.toLowerCase()}
                    height={20}
                    className="size-5 shrink-0"
                  />
                  <span className="flex-1">{country.name}</span>
                  <CheckIcon
                    className={cn(
                      "size-4 shrink-0",
                      selected?.alpha3 === country.alpha3
                        ? "opacity-100"
                        : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default CountryDropdown;
