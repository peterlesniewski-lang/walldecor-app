export function selectedOptionValues(select: HTMLSelectElement) {
  return Array.from(select.selectedOptions, (option) => option.value)
}
