import { formatPrice } from '@defishares/core';
import type { AccountAssetBalance } from '@defishares/core';

export function AccountAssetCard({ balance }: { balance: AccountAssetBalance }) {
  return <div className="asset-card">
    <div className="asset-card-top"><span className="asset-badge">{balance.symbol.slice(0, 1)}</span><span className="muted">{balance.assetId}</span></div>
    <strong>{formatPrice(balance.amount, balance.precision)}</strong>
    <span>{balance.symbol}</span>
  </div>;
}
