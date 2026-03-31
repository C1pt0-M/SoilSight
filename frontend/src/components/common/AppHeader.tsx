import { BarChart3, Bot, Info, Layout, Map } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useAssistantStore } from '../../store/assistantStore';
import './AppHeader.css';

const AppHeader: React.FC = () => {
  const openGeneralAssistant = useAssistantStore((state) => state.openGeneralAssistant);
  return (
    <header className="app-header">
      <div className="header-left">
        <NavLink to="/" className="logo">
          <Layout className="logo-icon" />
          <span className="logo-text">土瞰 SoilSight</span>
        </NavLink>
        <div className="scene-tag">新疆特色作物土壤质量评估与规划建议</div>
        <div className="data-tag">2010–2025 生长季 · 500m</div>
      </div>
      <nav className="header-nav">
        <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} end>
          <Map size={16} />
          <span>地图评估</span>
        </NavLink>
        <NavLink to="/ledger" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <BarChart3 size={16} />
          <span>区域统计</span>
        </NavLink>
        <NavLink
          to="/ai"
          className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          onClick={() => openGeneralAssistant()}
        >
          <Bot size={16} />
          <span>规划工作台</span>
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
          <Info size={16} />
          <span>系统说明</span>
        </NavLink>
      </nav>
    </header>
  );
};

export default AppHeader;
