import React from 'react';
import type { SelectHTMLAttributes } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';

type Option = { value: string; label: React.ReactNode; disabled?: boolean };

function collectOptions(children: React.ReactNode): Option[] {
  return React.Children.toArray(children).flatMap((child): Option[] => {
    if (!React.isValidElement<{ value?: string; children?: React.ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === React.Fragment) return collectOptions(child.props.children);
    if (child.type !== 'option') return [];
    return [{ value: String(child.props.value ?? child.props.children ?? ''), label: child.props.children, disabled: child.props.disabled }];
  });
}

/** Native-shaped adapter for the existing date / revision-safe form handlers.
 * Rendering, Portal, keyboard navigation and focus all come from Mira / Base UI.
 * The only adapted event field is target.value; no business rules live here.
 */
export function FormSelect({ children, value, defaultValue, onChange, id, className, name, disabled, required, 'aria-label': ariaLabel, 'aria-describedby': describedBy, 'aria-invalid': invalid }: SelectHTMLAttributes<HTMLSelectElement>) {
  const options = collectOptions(children);
  return (
    <Select
      value={value === undefined ? undefined : String(value)}
      defaultValue={defaultValue === undefined ? undefined : String(defaultValue)}
      items={options}
      name={name}
      disabled={disabled}
      required={required}
      onValueChange={(next) => {
        const target = { value: String(next ?? ''), id: id ?? '', name: name ?? '' };
        onChange?.({ target, currentTarget: target } as React.ChangeEvent<HTMLSelectElement>);
      }}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} aria-describedby={describedBy} aria-invalid={invalid} className={className} data-field={id ?? ariaLabel} data-current-value={value === undefined ? undefined : String(value)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled} data-value={option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
