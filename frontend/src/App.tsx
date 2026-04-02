import { Suspense } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapAssessmentPage from './pages/MapAssessmentPage/MapAssessmentPage';
import {
  LazyAboutPage,
  LazyAIAssistantPage,
  LazyDataLedgerPage,
  LazyReportPage,
} from './app/routeChunks';
import './styles/tokens.css';

const RouteFallback = () => (
  <div
    style={{
      minHeight: '100vh',
      display: 'grid',
      placeItems: 'center',
      padding: '32px',
      background: '#f6f0e6',
      color: '#5f5649',
      fontSize: '14px',
    }}
  >
    页面加载中...
  </div>
);

function App() {
  return (
    <Router>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<MapAssessmentPage />} />
          <Route path="/map" element={<Navigate to="/" replace />} />
          <Route path="/ledger" element={<LazyDataLedgerPage />} />
          <Route path="/ai" element={<LazyAIAssistantPage />} />
          <Route path="/about" element={<LazyAboutPage />} />
          <Route path="/report" element={<LazyReportPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Router>
  );
}

export default App;
