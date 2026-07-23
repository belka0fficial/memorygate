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
import EvidencesScreen from './screens/EvidencesScreen';
import ObservationsScreen from './screens/ObservationsScreen';
import PatternsScreen from './screens/PatternsScreen';
import BriefingScreen from './screens/BriefingScreen';
import TranscriptsScreen from './screens/TranscriptsScreen';
import SettingsScreen from './screens/SettingsScreen';
import DevScreen from './screens/DevScreen';
import DatabaseScreen from './screens/DatabaseScreen';
import PipelineScreen from './screens/PipelineScreen';
import WindowsScreen from './screens/WindowsScreen';
import EpisodesScreen from './screens/EpisodesScreen';
import RuntimeScreen from './screens/RuntimeScreen';
import MemoryLabScreen from './screens/MemoryLabScreen';

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
            <Route path="/pipeline" element={<PipelineScreen />} />
            <Route path="/runtime" element={<RuntimeScreen />} />
            <Route path="/lab" element={<MemoryLabScreen />} />
            <Route path="/windows" element={<WindowsScreen />} />
            <Route path="/database" element={<DatabaseScreen />} />
            <Route path="/beliefs" element={<BeliefsScreen />} />
            <Route path="/memories" element={<MemoriesScreen />} />
            <Route path="/entities" element={<EntitiesScreen />} />
            <Route path="/evidences" element={<EvidencesScreen />} />
            <Route path="/episodes" element={<EpisodesScreen />} />
            <Route path="/observations" element={<ObservationsScreen />} />
            <Route path="/patterns" element={<PatternsScreen />} />
            <Route path="/briefing" element={<BriefingScreen />} />
            <Route path="/transcripts" element={<TranscriptsScreen />} />
            <Route path="/dev" element={<DevScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
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
