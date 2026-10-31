// Temporary page shown until the owner builds the real one.
export default function Placeholder({ title, owner, bare = false }) {
  const content = (
    <div className="card empty-state">
      <h2>{title}</h2>
      <p className="muted">This page is coming soon. Owner: {owner}.</p>
    </div>
  );
  return bare ? <div className="auth-shell">{content}</div> : content;
}
