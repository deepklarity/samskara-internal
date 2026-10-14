import { useCombobox } from "downshift"
import { ChevronDown } from "lucide-react"
import { useId } from "react"
import { ComboboxMenu, suggestionsFor } from "./combobox.js"
import { controlClass, labelClass } from "./TextField.js"
import { Input } from "./ui/input.js"
import { Label } from "./ui/label.js"

type Props = {
  readonly label: string
  readonly value: string
  readonly options: ReadonlyArray<string>
  readonly onChange: (value: string) => void
  readonly placeholder?: string
}

export const Autocomplete = ({ label, value, options, onChange, placeholder }: Props) => {
  const inputId = useId()
  const items = suggestionsFor(options, value, (option) => option)
  const {
    isOpen,
    highlightedIndex,
    getLabelProps,
    getInputProps,
    getToggleButtonProps,
    getMenuProps,
    getItemProps,
  } = useCombobox<string>({
    inputId,
    items: [...items],
    inputValue: value,
    itemToString: (item) => item ?? "",
    onInputValueChange: ({ inputValue }) => onChange(inputValue),
  })

  return (
    <div className="min-w-0">
      <Label {...getLabelProps()} htmlFor={inputId} className={labelClass}>
        {label}
      </Label>
      <div className="relative mt-1">
        <Input
          className={`${controlClass} mt-0 pr-7`}
          placeholder={placeholder}
          {...getInputProps({ id: inputId })}
        />
        <button
          type="button"
          aria-label={`Show ${label} suggestions`}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          {...getToggleButtonProps()}
        >
          <ChevronDown className="size-3.5" />
        </button>
        <ComboboxMenu
          open={isOpen}
          items={items}
          highlightedIndex={highlightedIndex}
          labelOf={(item) => item}
          keyOf={(item) => item}
          getMenuProps={getMenuProps}
          getItemProps={getItemProps}
        />
      </div>
    </div>
  )
}
