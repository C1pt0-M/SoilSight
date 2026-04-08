import React from 'react';
import AppHeader from '../../components/common/AppHeader';
import './AboutPage.css';

const AboutPage: React.FC = () => {
  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <AppHeader />
      <main className="about-main">
        <div className="about-container">
          <h1 className="about-title">系统说明</h1>

          <section className="organic-card about-section">
            <h2>系统愿景</h2>
            <p>
              天山土智当前主线聚焦新疆特色作物系统。
              系统整合 MODIS 植被指数、SoilGrids 土壤理化数据、ERA5-Land 气候水文数据、
              SRTM 地形数据与耕地/作物分布图层，构建面向棉花、甜菜等特色作物场景的 profile-based 评分与决策支持流程，
              用于识别特色作物系统中的水盐约束、土壤本底短板与管理风险。
            </p>
          </section>

          <section className="organic-card about-section disclaimer">
            <h2>免责声明</h2>
            <ul>
              <li>本系统评估结果基于卫星遥感代理指标，作为决策辅助工具，不能替代实地检测。</li>
              <li>主评分主要基于 2010–2025 生长季的历史统计指标，不代表当前瞬时状态。</li>
              <li>特色作物评分是 literature-informed 的工程化聚合结果，适合作为区域研判与规划入口，不直接替代田间处方。</li>
              <li>系统建议需结合当地灌排条件、农艺管理与专家经验共同校核。</li>
            </ul>
          </section>

          <section className="organic-card about-section">
            <h2>术语定义</h2>
            <div className="term-list">
              <div className="term-item">
                <strong>棉花导向土壤支撑评分（Cotton Profile Score）</strong>
                <span>面向新疆棉花主导像元的主评分（0–100），只聚合土壤本底、供水支撑、盐分安全与地形约束四个主分量。</span>
              </div>
              <div className="term-item">
                <strong>Soil Base — 土壤本底</strong>
                <span>SOC、CEC、pH 与黏粒含量的加权复合，用于表示棉田长期生产所需的土壤基础支撑。</span>
              </div>
              <div className="term-item">
                <strong>Water Supply — 供水支撑</strong>
                <span>由根区土壤湿度（RZSM）和干旱指数（AI）构成，反映新疆棉田水分供给与保墒支撑能力。</span>
              </div>
              <div className="term-item">
                <strong>Salt Safety — 盐分安全</strong>
                <span>盐分相关图层的安全度评分。盐分安全是新疆棉田评分里的核心主分量之一。</span>
              </div>
              <div className="term-item">
                <strong>Terrain — 地形约束</strong>
                <span>由坡度等地形指标构成，反映灌排、经营和机采一致性的空间约束。</span>
              </div>
              <div className="term-item">
                <strong>Crop Support — 作物表现旁路</strong>
                <span>基于 NDVI 均值和稳定性构建的结果层解释指标，只用于说明作物表现，不并入主评分。</span>
              </div>
            </div>
          </section>

          <section className="organic-card about-section">
            <h2>技术架构</h2>
            <div className="arch-grid">
              <div className="arch-item">
                <strong>后端</strong>
                <span>支持像元级快速查询与地块信息返回，用于地图点选评估与区域分析。</span>
              </div>
              <div className="arch-item">
                <strong>前端</strong>
                <span>提供地图评估、区域统计与规划展示三类交互界面。</span>
              </div>
              <div className="arch-item">
                <strong>数据管线</strong>
                <span>完成多源遥感、土壤、气象与地形数据的统一处理、指标构建与图层生成。</span>
              </div>
            </div>
          </section>

          <section className="organic-card about-section">
            <h2>数据范围</h2>
            <div className="version-info">
              <div><strong>评估范围：</strong>新疆维吾尔自治区特色作物主导耕地像元</div>
              <div><strong>基线时段：</strong>2010–2025 年生长季（5–9 月）</div>
              <div><strong>空间分辨率：</strong>MODIS Sinusoidal 500m</div>
              <div><strong>适用对象：</strong>耕地占比达到阈值，且棉花或甜菜占比达到对应主导阈值的特色作物主导像元</div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
};

export default AboutPage;
