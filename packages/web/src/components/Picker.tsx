import { useCombobox } from "downshift"
import { ChevronDown, X } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import type { FilterOption } from "../api/types.js"
import { ComboboxMenu, optionFor, suggestionsFor } from "./combobox.js"
import { controlClass, labelClass } from "./TextField.js"
import { Input } from "./ui/input.js"
import { Label } from "./ui/label.js"

const MAX_SUGGESTIONS = 50

type Props = {
  readonly label: string
  readonly value: string
  readonly options: ReadonlyArray<FilterOption>
  readonly onChange: (value: string) => void
  readonly placeholder?: string
}

export const Picker = ({ label, value, options, onChange, placeholder }: Props) => {
  const inputId = useId()
  const selected = optionFor(options, value)
  const display = selected?.label ?? value
  const [draft, setDraft] = useState(display)

  const synced = useRef(value)
  useEffect(() => {
    const applied = synced.current !== value
    synced.current = value
    if (applied || document.activeElement?.id !== inputId) setDraft(display)
  }, [display, value, inputId])

  const items = suggestionsFor(
    options,
    draft === display ? "" : draft,
    (option) => option.label,
    MAX_SUGGESTIONS,
  )

  const {
    isOpen,
    highlightedIndex,
    selectItem,
    getLabelProps,
    getInputProps,
    getToggleButtonProps,
    getMenuProps,
    getItemProps,
  } = useCombobox<FilterOption>({
    inputId,
    items: [...items],
    inputValue: draft,
    itemToString: (item) => item?.label ?? "",
    stateReducer: (state, { type, changes }) =>
      type === useCombobox.stateChangeTypes.InputBlur
        ? { ...changes, selectedItem: state.selectedItem, inputValue: state.inputValue }
        : changes,
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem != null && selectedItem.value !== value) onChange(selectedItem.value)
    },
    onInputValueChange: ({ inputValue, type }) => {
      if (type === useCombobox.stateChangeTypes.InputKeyDownEscape) {
        setDraft(display)
        return
      }
      setDraft(inputValue)
      if (inputValue === "" && value !== "" && type === useCombobox.stateChangeTypes.InputChange)
        onChange("")
    },
  })

  useEffect(() => {
    if (selected === null && value !== "") return
    selectItem(selected)
  }, [value, selected, selectItem])

  return (
    <div className="min-w-0">
      <Label {...getLabelProps()} htmlFor={inputId} className={labelClass}>
        {label}
      </Label>
      <div className="relative mt-1">
        <Input
          className={`${controlClass} mt-0 pr-12`}
          placeholder={placeholder}
          {...getInputProps({ id: inputId, onBlur: () => setDraft(display) })}
        />
        {draft === "" ? null : (
          <button
            type="button"
            aria-label={`Clear ${label}`}
            onClick={() => {
              setDraft("")
              if (value !== "") onChange("")
            }}
            className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
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
          labelOf={(item) => item.label}
          keyOf={(item) => item.value}
          getMenuProps={getMenuProps}
          getItemProps={getItemProps}
        />
      </div>
    </div>
  )
}
