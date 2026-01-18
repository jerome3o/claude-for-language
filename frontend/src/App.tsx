import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { OfflineBanner } from './components/OfflineBanner';
import { HomePage } from './pages/HomePage';
import { SplashPage } from './pages/SplashPage';
import { DecksPage, NewDeckPage } from './pages/DecksPage';
import { DeckDetailPage } from './pages/DeckDetailPage';
import { StudyPage } from './pages/StudyPage';
import { SessionReviewPage } from './pages/SessionReviewPage';
import { GeneratePage } from './pages/GeneratePage';
import { AdminPage } from './pages/AdminPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
import { ConnectionDetailPage } from './pages/ConnectionDetailPage';
import { ChatPage } from './pages/ChatPage';
import { StudentProgressPage } from './pages/StudentProgressPage';
import { DayDetailPage } from './pages/DayDetailPage';
import { CardReviewDetailPage } from './pages/CardReviewDetailPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function HomeOrSplash() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="container" style={{ textAlign: 'center', padding: '3rem' }}>
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SplashPage />;
  }

  return (
    <>
      <Header />
      <HomePage />
    </>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeOrSplash />} />
      <Route
        path="/decks"
        element={
          <ProtectedRoute>
            <Header />
            <DecksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/decks/new"
        element={
          <ProtectedRoute>
            <Header />
            <NewDeckPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/decks/:id"
        element={
          <ProtectedRoute>
            <Header />
            <DeckDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/study"
        element={
          <ProtectedRoute>
            <Header />
            <StudyPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/study/review/:id"
        element={
          <ProtectedRoute>
            <Header />
            <SessionReviewPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/generate"
        element={
          <ProtectedRoute>
            <Header />
            <GeneratePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <Header />
            <AdminPage />
          </AdminRoute>
        }
      />
      <Route
        path="/connections"
        element={
          <ProtectedRoute>
            <Header />
            <ConnectionsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId"
        element={
          <ProtectedRoute>
            <Header />
            <ConnectionDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/chat/:convId"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/progress"
        element={
          <ProtectedRoute>
            <Header />
            <StudentProgressPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/progress/day/:date"
        element={
          <ProtectedRoute>
            <Header />
            <DayDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/progress/day/:date/card/:cardId"
        element={
          <ProtectedRoute>
            <Header />
            <CardReviewDetailPage />
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <NetworkProvider>
          <BrowserRouter>
            <AppRoutes />
            <OfflineBanner />
          </BrowserRouter>
        </NetworkProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
