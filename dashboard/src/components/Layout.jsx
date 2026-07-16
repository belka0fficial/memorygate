import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Home, Sparkles, Share2, Eye, TrendingUp, Sunrise, FileText, Brain, MoreHorizontal, ChevronDown, ChevronRight } from 'lucide-react';
import Logo from './Logo';
import AgentSelector from './AgentSelector';

const PRIMARY_NAV_ITEMS = [
  { to: '/overview', label: 'Overview', icon: Home },
  { to: '/beliefs', label: 'Beliefs', icon: Sparkles },
  { to: '/entities', label: 'Entities', icon: Share2 },
  { to: '/briefing', label: 'Briefing', icon: Sunrise },
  { to: '/transcripts', label: 'Transcripts', icon: FileText },
];

const DEBUG_NAV_ITEMS = [
  { to: '/memories', label: 'Memories', icon: Brain },
  { to: '/observations', label: 'Observations', icon: Eye },
  { to: '/patterns', label: 'Patterns', icon: TrendingUp },
];

const MOBILE_PRIMARY = PRIMARY_NAV_ITEMS.slice(0, 4);
const MOBILE_OVERFLOW = [PRIMARY_NAV_ITEMS[4], ...DEBUG_NAV_ITEMS];

function NavItem({ to, label, icon: Icon }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
          isActive
            ? 'bg-white/[0.06] text-text'
            : 'text-muted hover:bg-white/[0.04] hover:text-text'
        }`
      }
    >
      <Icon size={16} strokeWidth={2} />
      <span>{label}</span>
    </NavLink>
  );
}

function DesktopSidebar() {
  const location = useLocation();
  const debugActive = DEBUG_NAV_ITEMS.some((item) => location.pathname === item.to);
  const [debugOpen, setDebugOpen] = useState(debugActive);

  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface md:flex">
      <div className="px-5 py-5">
        <Logo />
      </div>
      <div className="px-3 pb-3">
        <AgentSelector />
      </div>
      <nav className="flex flex-1 flex-col gap-0.5 px-3">
        {PRIMARY_NAV_ITEMS.map((item) => <NavItem key={item.to} {...item} />)}

        <button
          onClick={() => setDebugOpen((o) => !o)}
          className="mt-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-muted hover:text-text"
        >
          {debugOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          Debug
        </button>
        {debugOpen && (
          <div className="flex flex-col gap-0.5 pl-1">
            {DEBUG_NAV_ITEMS.map((item) => <NavItem key={item.to} {...item} />)}
          </div>
        )}
      </nav>
      <div className="px-5 py-4 text-xs text-muted">v0.1.0</div>
    </aside>
  );
}

function MobileTabBar() {
  const [moreOpen, setMoreOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setMoreOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:hidden" ref={ref}>
      {moreOpen && (
        <div className="border-b border-border bg-surface">
          {MOBILE_OVERFLOW.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMoreOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-5 py-2.5 text-sm ${isActive ? 'text-accent' : 'text-muted'}`
              }
            >
              <Icon size={16} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
        </div>
      )}
      <div className="flex">
        {MOBILE_PRIMARY.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`
            }
          >
            <Icon size={20} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
        <button
          onClick={() => setMoreOpen((o) => !o)}
          className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] ${moreOpen ? 'text-accent' : 'text-muted'}`}
        >
          <MoreHorizontal size={20} strokeWidth={2} />
          More
        </button>
      </div>
    </nav>
  );
}

export default function Layout() {
  return (
    <div className="min-h-svh bg-background text-text">
      <DesktopSidebar />
      <MobileTabBar />
      <main className="pb-28 md:ml-60 md:pb-0">
        <Outlet />
      </main>
    </div>
  );
}
