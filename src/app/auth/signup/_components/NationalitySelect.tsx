"use client";

import { CountrySelect } from "react-country-state-city";
import "react-country-state-city/dist/react-country-state-city.css";

interface Props {
  id?: string;
  value: string;
  onChange: (name: string) => void;
}

// CountrySelect's types are broken — its props extend InputHTMLAttributes
// which creates an unsatisfiable intersection for onChange and defaultValue.
// The casts are isolated here so callers get a clean interface.
const AnyCountrySelect = CountrySelect as React.ComponentType<{
  id?: string;
  defaultValue?: string;
  inputClassName?: string;
  placeHolder?: string;
  onChange?: (country: { name: string }) => void;
}>;

export default function NationalitySelect({ id, value, onChange }: Props) {
  return (
    <AnyCountrySelect
      id={id}
      defaultValue={value || undefined}
      inputClassName="input"
      placeHolder="Select country…"
      onChange={(country) => onChange(country.name)}
    />
  );
}
