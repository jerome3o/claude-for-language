import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Header } from './components/Header';
import { HomePage } from './pages/HomePage';
import { DecksPage, NewDeckPage } from './pages/DecksPage';
import { DeckDetailPage } from './pages/DeckDetailPage';
import { StudyPage } from './pages/StudyPage';
import { SessionReviewPage } from './pages/SessionReviewPage';
import { GeneratePage } from './pages/GeneratePage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      retry: 1,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/decks" element={<DecksPage />} />
          <Route path="/decks/new" element={<NewDeckPage />} />
          <Route path="/decks/:id" element={<DeckDetailPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/study/review/:id" element={<SessionReviewPage />} />
          <Route path="/generate" element={<GeneratePage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
