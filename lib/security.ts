/** Small edge-compatible request guards shared by API routes. */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  return request.json().then((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('请求体必须是 JSON 对象');
    return value as Record<string, unknown>;
  });
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new Error('请求来源不受信任');
}

export function enforceRateLimit(request: Request, scope: string, limit = 12, windowMs = 60_000) {
  const forwarded =
    request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
  const key = `${scope}:${forwarded?.split(',')[0].trim() || 'anonymous'}`;
  const now = Date.now();
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    console.warn(JSON.stringify({ event: 'rate_limit', scope, key: key.replace(/:.*/, '') }));
    throw new Error('请求过于频繁，请稍后重试');
  }
}

export function secureRandomIndex(length: number) {
  if (length <= 0) throw new Error('随机范围无效');
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return bytes[0] % length;
}
