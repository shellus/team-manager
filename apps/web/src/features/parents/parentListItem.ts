export function parentListIdentity(account: { remark?: string; email: string }): string {
  const email = account.email.trim();
  const remark = account.remark?.trim();
  if (!remark || remark.toLowerCase() === email.toLowerCase()) return email;
  return `${remark} · ${email}`;
}

export function parentSeatUsageClass(seatCount: number | undefined, includedSeatCount: number): string | undefined {
  if (seatCount === undefined) return undefined;
  if (seatCount > includedSeatCount) return 'text-warning';
  if (seatCount === includedSeatCount) return 'text-success';
  return undefined;
}
