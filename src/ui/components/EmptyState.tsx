import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  body: string;
  /** The actions that resolve the state; 24 px below the copy. */
  children?: ReactNode;
}

/** One shape for every full-screen empty/failure/end state. */
export function EmptyState({ icon, title, body, children }: EmptyStateProps) {
  return (
    <section className="screen screen--empty empty-state" aria-labelledby="empty-title">
      <span className="empty-state__icon" aria-hidden="true">
        {icon}
      </span>
      <h1 id="empty-title" className="empty-state__title">
        {title}
      </h1>
      <p className="empty-state__body">{body}</p>
      {children && <div className="empty-state__actions">{children}</div>}
    </section>
  );
}
