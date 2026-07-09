import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ReposPage from './pages/Repos';
import ScanNewPage from './pages/ScanNew';
import ScanViewPage from './pages/ScanView';
import FlowViewPage from './pages/FlowView';
import ScansListPage from './pages/ScansList';
import LinkageViewPage from './pages/LinkageView';

export default function App() {
  const loc = useLocation();
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Blast Radius Demo</span>
        <nav>
          <NavLink to="/repos" active={loc.pathname.startsWith('/repos')}>Repos</NavLink>
          <NavLink to="/scans" active={loc.pathname.startsWith('/scans')}>Scans</NavLink>
          <NavLink to="/scans/new" active={loc.pathname === '/scans/new'}>New scan</NavLink>
        </nav>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/repos" replace />} />
          <Route path="/repos" element={<ReposPage />} />
          <Route path="/scans" element={<ScansListPage />} />
          <Route path="/scans/new" element={<ScanNewPage />} />
          <Route path="/scans/:id" element={<ScanViewPage />} />
          <Route path="/scans/:id/linkages" element={<LinkageViewPage />} />
          <Route path="/findings/:id/flow" element={<FlowViewPage />} />
        </Routes>
      </main>
    </div>
  );
}

function NavLink({ to, active, children }: { to: string; active: boolean; children: React.ReactNode }) {
  return <Link to={to} className={active ? 'nav-link active' : 'nav-link'}>{children}</Link>;
}
