import { Link } from 'react-router-dom';

export function RNScreenHeader({ title, backTo = '/', action }: { title: string; backTo?: string; action?: React.ReactNode }) {
  return <header className="rn-screen-header"><Link className="rn-screen-back" to={backTo} aria-label="返回">‹</Link><h1>{title}</h1><div className="rn-screen-action">{action || <span />}</div></header>;
}
