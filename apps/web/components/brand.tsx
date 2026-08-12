import Link from 'next/link';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" href="/" aria-label="Cairn 首页">
      <span className="brand-mark" aria-hidden="true">
        <i /><i /><i />
      </span>
      {!compact && (
        <span className="brand-type">
          <strong>Cairn</strong>
          <small>垒石为证</small>
        </span>
      )}
    </Link>
  );
}
