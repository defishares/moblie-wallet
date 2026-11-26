/** Session-wide guards survive navigating away from the withdrawal screen. */
const submittingAccounts = new Set<string>();
const balanceCeilings = new Map<string, bigint>();

export const withdrawalGuard = {
  begin(accountId: string): boolean {
    if (submittingAccounts.has(accountId)) return false;
    submittingAccounts.add(accountId);
    return true;
  },
  end(accountId: string): void {
    submittingAccounts.delete(accountId);
  },
  available(accountId: string, balance: bigint): bigint {
    const ceiling = balanceCeilings.get(accountId);
    return ceiling !== undefined && balance > ceiling ? ceiling : balance;
  },
  observeFreshBalance(accountId: string, balance: bigint): bigint {
    const ceiling = balanceCeilings.get(accountId);
    // Only a direct chain response may release the local deduction. Cached
    // balance refreshes can arrive out of order after a successful transfer.
    if (ceiling !== undefined && balance <= ceiling) {
      balanceCeilings.delete(accountId);
    }
    return this.available(accountId, balance);
  },
  transferred(accountId: string, before: bigint, amount: bigint): bigint {
    const remaining = this.available(accountId, before) - amount;
    const ceiling = remaining > 0n ? remaining : 0n;
    balanceCeilings.set(accountId, ceiling);
    return ceiling;
  },
};
