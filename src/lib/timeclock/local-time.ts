export function toLocalInput(iso: string) {
  const date = new Date(iso);
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function fromLocalInput(value: string, original: string) {
  if (value === toLocalInput(original)) return original;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || toLocalInput(date.toISOString()).slice(0, 16) !== value.slice(0, 16)) {
    throw new Error("Choose a valid local date and time.");
  }
  return date.toISOString();
}
