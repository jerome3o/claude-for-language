import { lazy, Suspense, useEffect, useRef } from 'react';
import { startAnalytics, track, trackScreen } from './services/analytics';
import { BUILD_TIME } from './utils/appUpdates';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { NetworkProvider } from './contexts/NetworkContext';
import { ProtectedRoute, AdminRoute } from './components/ProtectedRoute';
import { Header } from './components/Header';
import { OfflineBanner } from './components/OfflineBanner';
import { FeedbackFAB } from './components/FeedbackFAB';
import { CallAlerts } from './components/calls/CallAlerts';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Loading } from './components/Loading';
import { LandingResolver } from './components/nav/LandingResolver';
import { nativeRouteAction } from './components/nav/nativeRoute';
// Eagerly loaded — these are the landing pages
import { HomePage } from './pages/HomePage';
import { SplashPage } from './pages/SplashPage';

// Lazy-loaded pages
const DeckDetailPage = lazy(() => import('./pages/DeckDetailPage').then(m => ({ default: m.DeckDetailPage })));
const StudyPage = lazy(() => import('./pages/StudyPage').then(m => ({ default: m.StudyPage })));
const HomeworkDraftPage = lazy(() => import('./pages/tutor/HomeworkDraftPage').then(m => ({ default: m.HomeworkDraftPage })));
const HomeworkPage = lazy(() => import('./pages/HomeworkPage').then(m => ({ default: m.HomeworkPage })));
const TutorNotesPage = lazy(() => import('./pages/TutorNotesPage').then(m => ({ default: m.TutorNotesPage })));
const TutorNotesPracticePage = lazy(() => import('./pages/TutorNotesPracticePage').then(m => ({ default: m.TutorNotesPracticePage })));
const HomeworkPassPage = lazy(() => import('./pages/HomeworkPassPage').then(m => ({ default: m.HomeworkPassPage })));
const SessionReviewPage = lazy(() => import('./pages/SessionReviewPage').then(m => ({ default: m.SessionReviewPage })));
const GeneratePage = lazy(() => import('./pages/GeneratePage').then(m => ({ default: m.GeneratePage })));
const SentenceAnalysisPage = lazy(() => import('./pages/SentenceAnalysisPage').then(m => ({ default: m.SentenceAnalysisPage })));
const SentenceCoachPage = lazy(() => import('./pages/SentenceCoachPage').then(m => ({ default: m.SentenceCoachPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const ConnectionDetailPage = lazy(() => import('./pages/ConnectionDetailPage').then(m => ({ default: m.ConnectionDetailPage })));
const ChatPage = lazy(() => import('./pages/ChatPage').then(m => ({ default: m.ChatPage })));
const StudentProgressPage = lazy(() => import('./pages/StudentProgressPage').then(m => ({ default: m.StudentProgressPage })));
const SessionNotesPage = lazy(() => import('./pages/tutor/SessionNotesPage').then(m => ({ default: m.SessionNotesPage })));
const StudentInsightsPage = lazy(() => import('./pages/tutor/StudentInsightsPage').then(m => ({ default: m.StudentInsightsPage })));
const StudentHistoryPage = lazy(() => import('./pages/tutor/StudentHistoryPage').then(m => ({ default: m.StudentHistoryPage })));
const StudentLessonAttemptsPage = lazy(() => import('./pages/LessonAttemptsPage').then(m => ({ default: m.StudentLessonAttemptsPage })));
const MyLessonAttemptsPage = lazy(() => import('./pages/LessonAttemptsPage').then(m => ({ default: m.MyLessonAttemptsPage })));
const ExerciseCataloguePage = lazy(() => import('./pages/editor/ExerciseCataloguePage').then(m => ({ default: m.ExerciseCataloguePage })));
const CatalogueTrialPage = lazy(() => import('./pages/editor/ExerciseCataloguePage').then(m => ({ default: m.CatalogueTrialPage })));
const RecordingsInboxPage = lazy(() => import('./pages/tutor/RecordingsInboxPage').then(m => ({ default: m.RecordingsInboxPage })));
const SharedDeckProgressPage = lazy(() => import('./pages/SharedDeckProgressPage').then(m => ({ default: m.SharedDeckProgressPage })));
const DayDetailPage = lazy(() => import('./pages/DayDetailPage').then(m => ({ default: m.DayDetailPage })));
const CardReviewDetailPage = lazy(() => import('./pages/CardReviewDetailPage').then(m => ({ default: m.CardReviewDetailPage })));
const MyProgressPage = lazy(() => import('./pages/MyProgressPage').then(m => ({ default: m.MyProgressPage })));
const MyDayDetailPage = lazy(() => import('./pages/MyDayDetailPage').then(m => ({ default: m.MyDayDetailPage })));
const MyCardReviewDetailPage = lazy(() => import('./pages/MyCardReviewDetailPage').then(m => ({ default: m.MyCardReviewDetailPage })));
const ReadersListPage = lazy(() => import('./pages/ReadersListPage').then(m => ({ default: m.ReadersListPage })));
const LessonNotesPage = lazy(() => import('./pages/LessonNotesPage').then(m => ({ default: m.LessonNotesPage })));
const StrokePracticePage = lazy(() => import('./pages/StrokePracticePage').then(m => ({ default: m.StrokePracticePage })));
const MiniLessonsPage = lazy(() => import('./pages/MiniLessonsPage').then(m => ({ default: m.MiniLessonsPage })));
const GenerateReaderPage = lazy(() => import('./pages/GenerateReaderPage').then(m => ({ default: m.GenerateReaderPage })));
const NewReaderPage = lazy(() => import('./pages/NewReaderPage').then(m => ({ default: m.NewReaderPage })));
const ReaderPage = lazy(() => import('./pages/ReaderPage').then(m => ({ default: m.ReaderPage })));
const ReaderEditorPage = lazy(() => import('./pages/editor/ReaderEditorPage').then(m => ({ default: m.ReaderEditorPage })));
const ReaderPrintPage = lazy(() => import('./pages/editor/ReaderPrintPage').then(m => ({ default: m.ReaderPrintPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(m => ({ default: m.SettingsPage })));
const SentenceCoveragePage = lazy(() => import('./pages/SentenceCoveragePage').then(m => ({ default: m.SentenceCoveragePage })));
const ConversationVoicesPage = lazy(() => import('./pages/ConversationVoicesPage').then(m => ({ default: m.ConversationVoicesPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(m => ({ default: m.SearchPage })));
const DecksPage = lazy(() => import('./pages/DecksPage').then(m => ({ default: m.DecksPage })));
const ChatsPage = lazy(() => import('./pages/ChatsPage').then(m => ({ default: m.ChatsPage })));
const MorePage = lazy(() => import('./pages/MorePage').then(m => ({ default: m.MorePage })));
const DuplicateFinderPage = lazy(() => import('./pages/DuplicateFinderPage').then(m => ({ default: m.DuplicateFinderPage })));
const QuestsPage = lazy(() => import('./pages/QuestsPage').then(m => ({ default: m.QuestsPage })));
const QuestPlayPage = lazy(() => import('./pages/QuestPlayPage').then(m => ({ default: m.QuestPlayPage })));
const PictureHuntsPage = lazy(() => import('./pages/PictureHuntsPage').then(m => ({ default: m.PictureHuntsPage })));
const PictureHuntPlayPage = lazy(() => import('./pages/PictureHuntPlayPage').then(m => ({ default: m.PictureHuntPlayPage })));
const LessonEditorPage = lazy(() => import('./pages/editor/LessonEditorPage').then(m => ({ default: m.LessonEditorPage })));
const LessonLibraryPage = lazy(() => import('./pages/editor/LessonLibraryPage').then(m => ({ default: m.LessonLibraryPage })));
const LibraryItemPage = lazy(() => import('./pages/editor/LibraryItemPage').then(m => ({ default: m.LibraryItemPage })));
const LessonTryPage = lazy(() => import('./pages/editor/LessonTryPage').then(m => ({ default: m.LessonTryPage })));
const DeckTryPage = lazy(() => import('./pages/DeckTryPage').then(m => ({ default: m.DeckTryPage })));
const LessonPrintPage = lazy(() => import('./pages/editor/LessonPrintPage').then(m => ({ default: m.LessonPrintPage })));
const JoinPage = lazy(() => import('./pages/invites/JoinPage').then(m => ({ default: m.JoinPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const CardHubPage = lazy(() => import('./pages/CardHubPage').then(m => ({ default: m.CardHubPage })));
const ClaudeChatsPage = lazy(() => import('./pages/ClaudeChatsPage').then(m => ({ default: m.ClaudeChatsPage })));
const LessonBoardPage = lazy(() => import('./pages/LessonBoardPage').then(m => ({ default: m.LessonBoardPage })));
const MaterialsPage = lazy(() => import('./pages/MaterialsPage').then(m => ({ default: m.MaterialsPage })));
const MaterialViewerPage = lazy(() => import('./pages/MaterialsPage').then(m => ({ default: m.MaterialViewerPage })));
const CallsListPage = lazy(() => import('./pages/CallsListPage').then(m => ({ default: m.CallsListPage })));
const CallPage = lazy(() => import('./pages/CallPage').then(m => ({ default: m.CallPage })));
const CallReviewPage = lazy(() => import('./pages/CallReviewPage').then(m => ({ default: m.CallReviewPage })));

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

  // `/` applies the "Start on" preference on the app's initial entry only
  // (see components/nav/LandingResolver); the Study tab always shows home.
  return (
    <>
      <Header />
      <LandingResolver>
        <HomePage />
      </LandingResolver>
    </>
  );
}

function LazyFallback() {
  return <Loading message="Loading page..." />;
}

/**
 * Lets the native Android shell navigate the SPA without a full page reload.
 * MainActivity dispatches a 'native-navigate' CustomEvent (detail = route)
 * when the widget/shortcut fires while the app is already loaded.
 */
function NativeNavigationListener() {
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef('');
  here.current = location.pathname + location.search;
  useEffect(() => {
    const handler = (e: Event) => {
      const route = (e as CustomEvent<string>).detail;
      // A study reminder / the widget never stacks a second Study and leaves a homework pass,
      // a reader… on screen (components/nav/nativeRoute.ts); chat links always open.
      if (typeof route === 'string' && route.startsWith('/') && nativeRouteAction(here.current, route) === 'navigate') {
        navigate(route);
      }
    };
    window.addEventListener('native-navigate', handler);
    return () => window.removeEventListener('native-navigate', handler);
  }, [navigate]);
  return null;
}

/**
 * Usage analytics (docs/ANALYTICS.md): one hook on the router records every
 * screen change (screen views with time on screen).
 */
function AnalyticsListener() {
  const location = useLocation();
  useEffect(() => {
    startAnalytics();
    // A new app version is running (the previous launch had another build): app.update_applied.
    try {
      const last = localStorage.getItem('analytics-last-build');
      if (last !== BUILD_TIME) {
        if (last) track('app.update_applied');
        localStorage.setItem('analytics-last-build', BUILD_TIME);
      }
    } catch {
      // private mode
    }
    // Opened from a notification (public/push-sw.js adds ?notif=<kind>): record it, then drop the marker.
    try {
      const url = new URL(window.location.href);
      const kind = url.searchParams.get('notif');
      if (kind) {
        track('notification.tapped', { kind });
        url.searchParams.delete('notif');
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
      }
    } catch {
      // never
    }
  }, []);
  useEffect(() => {
    trackScreen(location.pathname);
  }, [location.pathname]);
  return null;
}

function AppRoutes() {
  return (
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      <Route path="/" element={<HomeOrSplash />} />
      {/* Public: the invite landing page works before sign-in and has no Header. */}
      <Route path="/join/:token" element={<JoinPage />} />
      {/* Public: the privacy policy (Google Play listing of the Lab app links here). */}
      <Route path="/privacy" element={<PrivacyPage />} />
      {/* Bottom tab bar destinations: Chats (every conversation) and More. Decks (deck list + card
          search) left the bar for More's first row; /decks is unchanged. */}
      <Route
        path="/chats"
        element={
          <ProtectedRoute>
            <Header />
            <ChatsPage />
          </ProtectedRoute>
        }
      />
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
        path="/more"
        element={
          <ProtectedRoute>
            <Header />
            <MorePage />
          </ProtectedRoute>
        }
      />
      {/* "Try it": a deck / library lesson as the student sees it, nothing recorded (immersive). */}
      <Route path="/decks/:id/try" element={<ProtectedRoute><DeckTryPage /></ProtectedRoute>} />
      <Route path="/library/:id/try" element={<ProtectedRoute><LessonTryPage /></ProtectedRoute>} />
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
        path="/coach"
        element={
          <ProtectedRoute>
            <Header />
            <SentenceCoachPage />
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
      <Route path="/connections/:relId/cards/:noteId" element={<ProtectedRoute><Header /><CardHubPage /></ProtectedRoute>} />
      <Route path="/connections/:relId/claude-chats" element={<ProtectedRoute><Header /><ClaudeChatsPage /></ProtectedRoute>} />
      <Route path="/connections/:relId/board" element={<ProtectedRoute><Header /><LessonBoardPage /></ProtectedRoute>} />
      <Route path="/connections/:relId/lesson-attempts" element={<ProtectedRoute><Header /><StudentLessonAttemptsPage /></ProtectedRoute>} />
      <Route path="/connections/:relId/lesson-attempts/:attemptId" element={<ProtectedRoute><Header /><StudentLessonAttemptsPage /></ProtectedRoute>} />
      <Route path="/cards/:noteId" element={<ProtectedRoute><Header /><CardHubPage /></ProtectedRoute>} />
      <Route path="/claude-chats" element={<ProtectedRoute><Header /><ClaudeChatsPage /></ProtectedRoute>} />
      <Route path="/calls" element={<ProtectedRoute><Header /><CallsListPage /></ProtectedRoute>} />
      <Route path="/materials" element={<ProtectedRoute><Header /><MaterialsPage /></ProtectedRoute>} />
      <Route path="/materials/:id" element={<ProtectedRoute><Header /><MaterialViewerPage /></ProtectedRoute>} />
      <Route path="/calls/:id" element={<ProtectedRoute><ErrorBoundary fallbackTitle="Couldn't open the call"><CallPage /></ErrorBoundary></ProtectedRoute>} />
      <Route path="/calls/:id/review" element={<ProtectedRoute><Header /><CallReviewPage /></ProtectedRoute>} />
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
      <Route path="/connections/:relId/homework/:jobId" element={<ProtectedRoute><Header /><HomeworkDraftPage /></ProtectedRoute>} />
      <Route
        path="/connections/:relId/session-notes"
        element={
          <ProtectedRoute>
            <Header />
            <SessionNotesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/insights"
        element={
          <ProtectedRoute>
            <Header />
            <StudentInsightsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/history"
        element={
          <ProtectedRoute>
            <Header />
            <StudentHistoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/connections/:relId/recordings"
        element={
          <ProtectedRoute>
            <Header />
            <RecordingsInboxPage />
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
        path="/profile"
        element={
          <ProtectedRoute>
            <Header />
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/sentences"
        element={
          <ProtectedRoute>
            <Header />
            <SentenceCoveragePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings/voices"
        element={
          <ProtectedRoute>
            <Header />
            <ConversationVoicesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/lessons"
        element={
          <ProtectedRoute>
            <Header />
            <MiniLessonsPage />
          </ProtectedRoute>
        }
      />
      <Route path="/homework" element={<ProtectedRoute><Header /><HomeworkPage /></ProtectedRoute>} />
      <Route path="/tutor-notes" element={<ProtectedRoute><Header /><TutorNotesPage /></ProtectedRoute>} />
      <Route
        path="/tutor-notes/practice"
        element={
          <ProtectedRoute>
            <Header />
            <ErrorBoundary fallbackTitle="Practice interrupted">
              <TutorNotesPracticePage />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      <Route
        path="/homework/:id"
        element={
          <ProtectedRoute>
            <Header />
            <ErrorBoundary fallbackTitle="Homework interrupted">
              <HomeworkPassPage />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lesson-notes"
        element={
          <ProtectedRoute>
            <Header />
            <LessonNotesPage />
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
      <Route path="/readers/new/edit" element={<ProtectedRoute><Header /><NewReaderPage /></ProtectedRoute>} />
      <Route
        path="/readers/:id/edit"
        element={
          <ProtectedRoute>
            <ErrorBoundary fallbackTitle="Couldn't load the editor"><ReaderEditorPage /></ErrorBoundary>
          </ProtectedRoute>
        }
      />
      <Route path="/readers/:id/print" element={<ProtectedRoute><ReaderPrintPage /></ProtectedRoute>} />
      <Route
        path="/readers/:id"
        element={
          <ProtectedRoute>
            <ReaderPage />
          </ProtectedRoute>
        }
      />
      <Route path="/practice/strokes" element={<ProtectedRoute><Header /><StrokePracticePage /></ProtectedRoute>} />
      <Route
        path="/quests"
        element={
          <ProtectedRoute>
            <Header />
            <QuestsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/picture-hunt"
        element={
          <ProtectedRoute>
            <Header />
            <PictureHuntsPage />
          </ProtectedRoute>
        }
      />
      {/* No <Header /> — a picture hunt takes over the whole screen while it is open. */}
      <Route
        path="/picture-hunt/:id"
        element={
          <ProtectedRoute>
            <ErrorBoundary fallbackTitle="Couldn't load this picture hunt">
              <PictureHuntPlayPage />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      {/* No <Header /> — a quest takes over the whole screen while it is open. */}
      <Route
        path="/quests/:id"
        element={
          <ProtectedRoute>
            <ErrorBoundary fallbackTitle="Couldn't load this quest">
              <QuestPlayPage />
            </ErrorBoundary>
          </ProtectedRoute>
        }
      />
      {/* Lesson library + editor. The editor and print view have their own chrome (no <Header />). */}
      <Route path="/library" element={<ProtectedRoute><Header /><LessonLibraryPage /></ProtectedRoute>} />
      <Route path="/library/catalogue" element={<ProtectedRoute><Header /><ExerciseCataloguePage /></ProtectedRoute>} />
      <Route path="/library/catalogue/:sampleId" element={<ProtectedRoute><CatalogueTrialPage /></ProtectedRoute>} />
      <Route path="/lesson-attempts" element={<ProtectedRoute><Header /><MyLessonAttemptsPage /></ProtectedRoute>} />
      <Route path="/lesson-attempts/:attemptId" element={<ProtectedRoute><Header /><MyLessonAttemptsPage /></ProtectedRoute>} />
      <Route path="/library/:id" element={<ProtectedRoute><Header /><LibraryItemPage /></ProtectedRoute>} />
      <Route path="/library/:id/edit" element={<ProtectedRoute><ErrorBoundary fallbackTitle="Couldn't load the editor"><LessonEditorPage target="library" /></ErrorBoundary></ProtectedRoute>} />
      <Route path="/library/:id/print" element={<ProtectedRoute><LessonPrintPage target="library" /></ProtectedRoute>} />
      <Route path="/lessons/:id/edit" element={<ProtectedRoute><ErrorBoundary fallbackTitle="Couldn't load the editor"><LessonEditorPage target="lesson" /></ErrorBoundary></ProtectedRoute>} />
      <Route path="/lessons/:id/print" element={<ProtectedRoute><LessonPrintPage target="lesson" /></ProtectedRoute>} />
      <Route
        path="/duplicate-finder"
        element={
          <ProtectedRoute>
            <Header />
            <DuplicateFinderPage />
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
            <NativeNavigationListener />
            <AnalyticsListener />
            <AppRoutes />
            <OfflineBanner />
            <FeedbackFAB />
            <CallAlerts />
          </BrowserRouter>
        </NetworkProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
