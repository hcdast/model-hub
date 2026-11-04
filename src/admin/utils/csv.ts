export function csvCell(value: unknown) {
  const text = String(value ?? '');
  return `"${text.replace(/^[\s]*[=+@-]/, match => `'${match}`).replace(/"/g, '""')}"`;
}
