export function truncate(value: string, maxChars: number, marker: string): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - marker.length))}${marker}`;
}
