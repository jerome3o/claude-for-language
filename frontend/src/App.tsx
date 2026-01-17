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
