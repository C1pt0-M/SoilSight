import { BarChart3, Bot, Info, Map } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { preloadRouteChunk } from '../../app/routeChunks';
import { useAssistantStore } from '../../store/assistantStore';
import logoImage from '../../../天山土智_logo.png';
import './AppHeader.css';

const AppHeader: React.FC = () => {
  const openGeneralAssistant = useAssistantStore((state) => state.openGeneralAssistant);
  return (
    <header className="app-header">
      <div className="header-left">
        <NavLink to="/" className="logo">
          <img className="logo-icon" src={logoImage} alt="天山土智 logo" />
          <span className="logo-text">天山土智</span>
        </NavLink>
        <div className="scene-tag">基于多源数据融合的新疆特色作物土壤健康评估与规划系统</div>
        <div className="data-tag">2010–2025 生长季 · 500m</div>
      </div>
      <nav className="header-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
          <Map size={16} />
          <span>地图评估</span>
        </NavLink>
        <NavLink
          to="/ledger"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onMouseEnter={() => void preloadRouteChunk('ledger')}
          onFocus={() => void preloadRouteChunk('ledger')}
        >
          <BarChart3 size={16} />
          <span>区域统计</span>
        </NavLink>
        <NavLink
          to="/ai"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => openGeneralAssistant()}
          onMouseEnter={() => void preloadRouteChunk('ai')}
          onFocus={() => void preloadRouteChunk('ai')}
        >
          <Bot size={16} />
          <span>规划工作台</span>
        </NavLink>
        <NavLink
          to="/about"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onMouseEnter={() => void preloadRouteChunk('about')}
          onFocus={() => void preloadRouteChunk('about')}
        >
          <Info size={16} />
          <span>系统说明</span>
        </NavLink>
      </nav>
    </header>
  );
};

export default AppHeader;
