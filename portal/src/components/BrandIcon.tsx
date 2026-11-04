/** Shared brand mark; the surrounding heading or link supplies its accessible name. */
export default function BrandIcon({ size = 32 }: { size?: number }) {
  return <img src="/model-hub-icon.svg" alt="" aria-hidden="true" width={size} height={size}
    style={{ display: 'block', flexShrink: 0 }} />;
}
