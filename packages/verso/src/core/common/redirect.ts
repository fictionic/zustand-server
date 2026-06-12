const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
export type RedirectStatusCode = typeof REDIRECT_STATUSES[number];

export function isRedirectStatus(code: number): code is RedirectStatusCode {
  return REDIRECT_STATUSES.includes(code);
}
