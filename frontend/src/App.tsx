import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Channels } from './pages/Channels';
import { LLMs } from './pages/LLMs';
import { Tools } from './pages/Tools';
import { Agents } from './pages/Agents';
import { Logs } from './pages/Logs';
import { Playground } from './pages/Playground';
import { KnowledgeBases } from './pages/KnowledgeBases';
import { EmbeddingModels } from './pages/EmbeddingModels';
import { Widgets } from './pages/Widgets';
import { ChangePassword } from './pages/ChangePassword';
import { AdminUsers } from './pages/AdminUsers';
import { ChatClient } from './pages/ChatClient';
import { Conversations } from './pages/Conversations';
import { Queues } from './pages/Queues';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public route - Login */}
          <Route path="/login" element={<Login />} />
          
          {/* Public Chat Client - No authentication required */}
          <Route path="/chat/:agentId" element={<ChatClient />} />
          
          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="channels" element={<Channels />} />
            <Route path="llms" element={<LLMs />} />
            <Route path="tools" element={<Tools />} />
            <Route path="agents" element={<Agents />} />
            <Route path="knowledge-bases" element={<KnowledgeBases />} />
            <Route path="embedding-models" element={<EmbeddingModels />} />
            <Route path="widgets" element={<Widgets />} />
            <Route path="conversations" element={<Conversations />} />
            <Route path="logs" element={<Logs />} />
            <Route path="playground" element={<Playground />} />
            <Route path="queues" element={<Queues />} />
            <Route path="change-password" element={<ChangePassword />} />
            <Route path="admin-users" element={<AdminUsers />} />
          </Route>
          
          {/* Redirect any unknown route to login */}
          <Route path="*" element={<Login />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
