import { Link } from "react-router-dom";

export function NotFound() {
  return (
    <div className="p-8 text-sm text-muted">
      <p className="mb-2 font-semibold text-fg">Project not found.</p>
      <Link to="/" className="text-accent underline">
        Back to projects
      </Link>
    </div>
  );
}
