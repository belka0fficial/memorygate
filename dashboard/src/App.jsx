import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AgentProvider } from './context/AgentContext';
import AuthScreen from './screens/AuthScreen';
import Layout from './components/Layout';
import OverviewScreen from './screens/OverviewScreen';
import BeliefsScreen from './screens/BeliefsScreen';
import MemoriesScreen from './screens/MemoriesScreen';
import EntitiesScreen from './screens/EntitiesScreen';
import ObservationsScreen from './screens/ObservationsScreen';
import PatternsScreen from './screens/PatternsScreen';
import BriefingScreen from './screens/BriefingScreen';
import TranscriptsScreen from './screens/TranscriptsScreen';

function Gate() {
  const { authed, checking } = useAuth();

  if (checking) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Loader2 size={20} className="animate-spin text-muted" />
      </div>
    );
  }

  if (!authed) return <AuthScreen />;

  return (
    <AgentProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/overview" replace />} />
            <Route path="/overview" element={<OverviewScreen />} />
            <Route path="/beliefs" element={<BeliefsScreen />} />
            <Route path="/memories" element={<MemoriesScreen />} />
            <Route path="/entities" element={<EntitiesScreen />} />
            <Route path="/observations" element={<ObservationsScreen />} />
            <Route path="/patterns" element={<PatternsScreen />} />
            <Route path="/briefing" element={<BriefingScreen />} />
            <Route path="/transcripts" element={<TranscriptsScreen />} />
            <Route path="*" element={<Navigate to="/overview" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AgentProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
