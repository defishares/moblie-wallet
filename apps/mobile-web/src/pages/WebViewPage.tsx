import { useSearchParams } from 'react-router-dom';
import { RNScreenHeader } from '../components/RNScreenHeader';

export function WebViewPage() {
  const [params] = useSearchParams();
  const title = params.get('title') || '网页';
  const url = params.get('url') || 'https://defishares.org';
  return <div className="page-stack rn-secondary-page rn-webview-page"><RNScreenHeader title={title} backTo="/settings"/><iframe title={title} src={url} className="rn-webview-frame" referrerPolicy="no-referrer" /></div>;
}
