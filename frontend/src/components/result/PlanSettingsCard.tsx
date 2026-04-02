import { Sparkles } from 'lucide-react';
import {
  IRRIGATION_CONSTRAINT_OPTIONS,
  PLAN_OBJECTIVE_OPTIONS,
  PROGRESS_MODE_OPTIONS,
  SCENARIO_PACK_OPTIONS,
} from '../../models/shi';
import type {
  IrrigationConstraint,
  PlanObjective,
  ProgressMode,
  ScenarioPackId,
} from '../../models/shi';

interface PlanSettingsCardProps {
  selectedScenarioPack: ScenarioPackId;
  selectedObjective: PlanObjective;
  selectedIrrigation: IrrigationConstraint;
  selectedProgressMode: ProgressMode;
  setSelectedScenarioPack: (value: ScenarioPackId) => void;
  setSelectedObjective: (value: PlanObjective) => void;
  setSelectedIrrigation: (value: IrrigationConstraint) => void;
  setSelectedProgressMode: (value: ProgressMode) => void;
  primaryLabel: string;
  primaryDisabled: boolean;
  onGenerate: () => void;
}

const PlanSettingsCard: React.FC<PlanSettingsCardProps> = ({
  selectedScenarioPack,
  selectedObjective,
  selectedIrrigation,
  selectedProgressMode,
  setSelectedScenarioPack,
  setSelectedObjective,
  setSelectedIrrigation,
  setSelectedProgressMode,
  primaryLabel,
  primaryDisabled,
  onGenerate,
}) => (
  <div className="plan-settings-card">
    <div className="plan-settings-header">
      <h4 className="sub-title">规划设置</h4>
      <p className="plan-settings-note">先在这里调整措施包、目标偏好、灌溉条件和推进节奏，再生成规划。</p>
    </div>
    <div className="plan-settings-grid">
      <label className="plan-settings-field">
        <span>措施包</span>
        <select
          value={selectedScenarioPack}
          onChange={(event) => setSelectedScenarioPack(event.target.value as ScenarioPackId)}
        >
          {SCENARIO_PACK_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="plan-settings-field">
        <span>目标偏好</span>
        <select
          value={selectedObjective}
          onChange={(event) => setSelectedObjective(event.target.value as PlanObjective)}
        >
          {PLAN_OBJECTIVE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="plan-settings-field">
        <span>灌溉条件</span>
        <select
          value={selectedIrrigation}
          onChange={(event) => setSelectedIrrigation(event.target.value as IrrigationConstraint)}
        >
          {IRRIGATION_CONSTRAINT_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="plan-settings-field">
        <span>推进节奏</span>
        <select
          value={selectedProgressMode}
          onChange={(event) => setSelectedProgressMode(event.target.value as ProgressMode)}
        >
          {PROGRESS_MODE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
    </div>
    <div className="plan-settings-actions">
      <button
        type="button"
        className="action-btn primary"
        onClick={onGenerate}
        disabled={primaryDisabled}
      >
        <Sparkles size={15} />
        <span>{primaryLabel}</span>
      </button>
    </div>
  </div>
);

export default PlanSettingsCard;
