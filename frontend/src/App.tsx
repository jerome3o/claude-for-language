import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { OfflineBanner } from './components/OfflineBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';
// Eagerly loaded — these are the landing pages
import { HomePage } from './pages/HomePage';
import { SplashPage } from './pages/SplashPage';

// Lazy-loaded pages
const DeckDetailPage = lazy(() => import('./pages/DeckDetailPage').then(m => ({ default: m.DeckDetailPage })));
const DeckProgressPage = lazy(() => import('./pages/DeckProgressPage').then(m => ({ default: m.DeckProgressPage })));
const StudyPage = lazy(() => import('./pages/StudyPage').then(m => ({ default: m.StudyPage })));
const SessionReviewPage = lazy(() => import('./pages/SessionReviewPage').then(m => ({ default: m.SessionReviewPage })));
const GeneratePage = lazy(() => import('./pages/GeneratePage').then(m => ({ default: m.GeneratePage })));
const SentenceAnalysisPage = lazy(() => import('./pages/SentenceAnalysisPage').then(m => ({ default: m.SentenceAnalysisPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const ConnectionDetailPage = lazy(() => import('./pages/ConnectionDetailPage').then(m => ({ default: m.ConnectionDetailPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })));
const StudentProgressPage = lazy(() => import('./pages/StudentProgressPage').then(m => ({ default: m.StudentProgressPage })));
const SharedDeckProgressPage = lazy(() => import('./pages/SharedDeckProgressPage').then(m => ({ default: m.SharedDeckProgressPage })));
const DayDetailPage = lazy(() => import('./pages/DayDetailPage').then(m => ({ default: m.DayDetailPage })));
const CardReviewDetailPage = lazy(() => import('./pages/CardReviewDetailPage').then(m => ({ default: m.CardReviewDetailPage })));
const MyProgressPage = lazy(() => import('./pages/MyProgressPage').then(m => ({ default: m.MyProgressPage })));
const MyDayDetailPage = lazy(() => import('./pages/MyDayDetailPage').then(m => ({ default: m.MyDayDetailPage })));
const MyCardReviewDetailPage = lazy(() => import('./pages/MyCardReviewDetailPage').then(m => ({ default: m.MyCardReviewDetailPage })));
const TutorReviewInboxPage = lazy(() => import('./pages/TutorReviewInboxPage').then(m => ({ default: m.TutorReviewInboxPage })));
const TutorReviewDetailPage = lazy(() => import('./pages/TutorReviewDetailPage').then(m => ({ default: m.TutorReviewDetailPage })));
const ReadersListPage = lazy(() => import('./pages/ReadersListPage').then(m => ({ default: m.ReadersListPage })));
const GenerateReaderPage = lazy(() => import('./pages/GenerateReaderPage').then(m => ({ default: m.GenerateReaderPage })));
const ReaderPage = lazy(() => import('./pages/ReaderPage').then(m => ({ default: m.ReaderPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })));

// Preload the study page since it's the most-used route
const studyPagePreload = () => import('./pages/StudyPage');

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

  // Preload the study page as soon as the user is authenticated
  if (isAuthenticated) {
    studyPagePreload();
  }

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

function LazyFallback() {
  return <Loading message="Loading page..." />;
}

function AppRoutes() {
  return (
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      <Route path="/" element={<HomeOrSplash />} />
      <Route
        path="/decks/:id"
        element={
          <ProtectedRoute>
            <Header />
            <ErrorBoundary fallbackTitle="Couldn't load this deck">
              <DeckDetailPage />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      <Route
        path="/decks/:deckId/progress"
        element={
          <ProtectedRoute>
            <Header />
            <DeckProgressPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/study"
        element={
          <ProtectedRoute>
            <Header />
            <ErrorBoundary fallbackTitle="Study session interrupted">
              <StudyPage />
            </ErrorBoundary>
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
        path="/analyze"
        element={
          <ProtectedRoute>
            <Header />
            <SentenceAnalysisPage />
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
        path="/progress"
        element={
          <ProtectedRoute>
            <Header />
            <MyProgressPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/progress/day/:date"
        element={
          <ProtectedRoute>
            <Header />
            <MyDayDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/progress/day/:date/card/:cardId"
        element={
          <ProtectedRoute>
            <Header />
            <MyCardReviewDetailPage />
          </ProtectedRoute>
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
            <ErrorBoundary fallbackTitle="Chat couldn't load">
              <ChatPage />
            </ErrorBoundary>
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
      <Route
        path="/connections/:relId/shared-decks/:sharedDeckId/progress"
        element={
          <ProtectedRoute>
            <Header />
            <SharedDeckProgressPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/student-shared-decks/:studentSharedDeckId/progress"
        element={
          <ProtectedRoute>
            <Header />
            <SharedDeckProgressPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tutor-reviews"
        element={
          <ProtectedRoute>
            <Header />
            <TutorReviewInboxPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tutor-reviews/:requestId"
        element={
          <ProtectedRoute>
            <Header />
            <TutorReviewDetailPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/search"
        element={
          <ProtectedRoute>
            <Header />
            <SearchPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <Header />
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/readers"
        element={
          <ProtectedRoute>
            <Header />
            <ReadersListPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/readers/generate"
        element={
          <ProtectedRoute>
            <Header />
            <GenerateReaderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/readers/:id"
        element={
          <ProtectedRoute>
            <ReaderPage />
          </ProtectedRoute>
        }
      />
    </Routes>
    </Suspense>
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
