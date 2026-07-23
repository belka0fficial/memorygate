import { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, Boxes, Brain, Braces, CalendarRange, Database, Eye, FileText, FlaskConical, Gauge, MoreHorizontal, Radio, Settings, Share2, Sparkles, TrendingUp, Waypoints } from 'lucide-react';
import Logo from './Logo';

const NAV_GROUPS = [
  { label: 'Operate', items: [
    { to: '/overview', label: 'Command Center', icon: Gauge },
    { to: '/pipeline', label: 'Live Pipeline', icon: Activity },
    { to: '/runtime', label: 'Agent Runtime', icon: Brain },
    { to: '/lab', label: 'Memory Lab', icon: FlaskConical },
    { to: '/windows', label: 'Memory Windows', icon: Boxes },
    { to: '/briefing', label: 'Realtime Context', icon: Radio },
  ] },
  { label: 'Knowledge', items: [
    { to: '/database', label: 'Database', icon: Database },
    { to: '/entities', label: 'Entities', icon: Share2 },
    { to: '/beliefs', label: 'Resolved Knowledge', icon: Sparkles },
    { to: '/memories', label: 'Data Objects', icon: Brain },
  ] },
  { label: 'Processing', items: [
    { to: '/evidences', label: 'Sources & Evidence', icon: Waypoints },
    { to: '/episodes', label: 'Episodes', icon: CalendarRange },
    { to: '/transcripts', label: 'Sessions', icon: FileText },
    { to: '/observations', label: 'Observations', icon: Eye },
    { to: '/patterns', label: 'Derived Patterns', icon: TrendingUp },
  ] },
  { label: 'System', items: [
    { to: '/dev', label: 'Architecture', icon: Braces },
    { to: '/settings', label: 'Settings', icon: Settings },
  ] },
];

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap((group) => group.items);
const MOBILE_PRIMARY = ALL_NAV_ITEMS.slice(0, 4);
const MOBILE_OVERFLOW = ALL_NAV_ITEMS.slice(4);

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
  return (
    <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-border bg-surface md:flex">
      <div className="px-5 py-5">
        <Logo />
      </div>
      <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => <div key={group.label}><div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted/60">{group.label}</div><div className="space-y-0.5">{group.items.map((item) => <NavItem key={item.to} {...item} />)}</div></div>)}
      </nav>
      <div className="px-5 py-4">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> MemoryGate online
        </div>
        <div className="text-xs text-muted">v0.1.0</div>
      </div>
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
