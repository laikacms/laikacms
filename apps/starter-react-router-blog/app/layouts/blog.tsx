import { Link, Outlet } from 'react-router';

export default function BlogLayout() {
  return (
    <div style={{ maxWidth: '48rem', margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      <nav style={{ marginBottom: '2rem' }}>
        <Link to="/" style={{ fontWeight: 'bold', textDecoration: 'none' }}>
          My Blog
        </Link>
        {' · '}
        <Link to="/admin">CMS</Link>
      </nav>
      <Outlet />
    </div>
  );
}
