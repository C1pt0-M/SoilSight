import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import MapAssessmentPage from './pages/MapAssessmentPage/MapAssessmentPage';
import DataLedgerPage from './pages/DataLedgerPage/DataLedgerPage';
import AIAssistantPage from './pages/AIAssistantPage/AIAssistantPage';
import AboutPage from './pages/AboutPage/AboutPage';
import './styles/tokens.css';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<MapAssessmentPage />} />
        <Route path="/map" element={<Navigate to="/" replace />} />
        <Route path="/ledger" element={<DataLedgerPage />} />
        <Route path="/ai" element={<AIAssistantPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
