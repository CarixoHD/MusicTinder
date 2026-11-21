import { CatalogError } from '../types';

/**
 * The only JSONP transport in the app (ADR-002). Deezer sends no CORS headers,
 * so a script tag is the sole browser transport; a future edge proxy replaces
 * this file and nothing else.
 */

export const DEEZER_JSONP_TIMEOUT_MS = 8000;

interface DeezerErrorPayload {
  error: { type: string; message: string; code: number };
}

const isDeezerError = (value: unknown): value is DeezerErrorPayload =>
  typeof value === 'object' && value !== null && 'error' in value;

// Deezer reports failures inside the payload: 4 = quota, 800 = no data.
const errorKind = (code: number): CatalogError['kind'] => {
  if (code === 4) return 'rate';
  if (code === 800) return 'notfound';
  return 'unknown';
};

// JSONP payload boundary: the value handed to the global callback is the
// caller-declared type, so this is one of the two sanctioned casts.
const globalScope = () => window as unknown as Record<string, unknown>;

let sequence = 0;

export function jsonp<T>(endpoint: string): Promise<T> {
  const callbackName = `__dz_jsonp_${++sequence}_${Date.now().toString(36)}`;
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}output=jsonp&callback=${callbackName}`;

  return new Promise<T>((resolve, reject) => {
    const script = document.createElement('script');

    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete globalScope()[callbackName];
    };

    const settle = (action: () => void) => {
      cleanup();
      action();
    };

    const fail = (error: CatalogError) => settle(() => reject(error));

    const timer = setTimeout(
      () => fail(new CatalogError('network', `Deezer request timed out after ${DEEZER_JSONP_TIMEOUT_MS} ms`)),
      DEEZER_JSONP_TIMEOUT_MS,
    );

    globalScope()[callbackName] = (payload: T | DeezerErrorPayload) => {
      cleanup();
      if (isDeezerError(payload)) {
        reject(new CatalogError(errorKind(payload.error.code), payload.error.message));
      } else {
        resolve(payload);
      }
    };

    script.async = true;
    script.src = url;
    script.onerror = () => fail(new CatalogError('network', `Deezer request failed (${endpoint})`));
    document.head.appendChild(script);
  });
}
