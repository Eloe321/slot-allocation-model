export function allowedOrigins(value: string | undefined): string[] | undefined {
  if (!value?.trim()) return undefined;

  return value
    .split(',')
    .map((origin) => new URL(origin.trim()).origin);
}

export function isLocalDevelopmentOrigin(origin: string | undefined): boolean {
  return !origin || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}
