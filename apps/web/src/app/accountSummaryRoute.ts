export function routeNeedsAccountSummaries(pathname: string): boolean {
  return pathname.startsWith('/parents') || pathname.startsWith('/subaccounts');
}
