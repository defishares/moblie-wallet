import { runtimeConfig } from '../services/runtime';
import { RNScreenHeader } from '../components/RNScreenHeader';

export function AboutPage() {
  return <div className="page-stack rn-secondary-page rn-about-page"><RNScreenHeader title="关于" backTo="/settings"/><section className="rn-about-logo"><span><img src="/assets/coins/DFS.png" alt="DefiShares"/></span><p>DefiShares v1.0.4</p></section><p className="rn-about-copy">DefiShares 是一款安全、高效的去中心化交易平台。基于石墨烯区块链技术打造，为您提供媲美中心化交易所的流畅体验，同时确保资产完全由您掌控。</p><section className="rn-about-contact"><h2>联系我们</h2><a href="https://defishares.org" target="_blank" rel="noreferrer"><span>官网：</span>https://defishares.org</a></section><footer className="rn-about-footer"><span>网络：{runtimeConfig.network.name}</span><i/> <span>模式：{import.meta.env.DEV ? 'Debug' : 'Release'}</span><small>DefiShares v1.0.4</small></footer></div>;
}
