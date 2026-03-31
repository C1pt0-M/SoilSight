from __future__ import annotations

import json
from typing import Any, Dict

from ..models import PlanSession, PlanStage, RuleTrace
from .lit_params import get_scenario_impacts_mean, get_scenario_speed_mean


SCENARIO_PACKS: Dict[str, Dict[str, Any]] = {
    "organic_boost": {
        "id": "organic_boost",
        "name": "有机质提升",
        "description": "以增施有机质与覆盖管理为核心，优先改善土壤基础与稳定性。",
        "speed": get_scenario_speed_mean("organic_boost"),
        "impacts": get_scenario_impacts_mean("organic_boost"),
        "default_actions": [
            "增加有机肥/秸秆还田与覆盖作物，减少裸地暴露。",
            "降低高频深翻，优先保育耕作以稳住团聚体结构。",
            "按阶段监测土壤盐分与含水变化，及时调整灌溉节奏。",
        ],
    },
    "irrigation_opt": {
        "id": "irrigation_opt",
        "name": "灌溉优化",
        "description": "围绕水分胁迫控制，优化灌溉频次与时机。",
        "speed": get_scenario_speed_mean("irrigation_opt"),
        "impacts": get_scenario_impacts_mean("irrigation_opt"),
        "default_actions": [
            "采用小水勤灌，避免一次性大水导致渗漏和次生盐渍化。",
            "高温阶段优先保墒，降温后再补水，减少蒸发损失。",
            "按周复核含水与降水预报，动态调整灌溉窗口。",
        ],
    },
    "salt_control": {
        "id": "salt_control",
        "name": "控盐排盐",
        "description": "以盐碱约束治理为核心，提升盐分相关地块可持续性。",
        "speed": get_scenario_speed_mean("salt_control"),
        "impacts": get_scenario_impacts_mean("salt_control"),
        "default_actions": [
            "设置分次淋洗与排盐时段，避免高蒸发时段集中灌溉。",
            "配合有机改良材料，提升保水与缓冲能力。",
            "盐分偏高区域优先耐盐作物或耐盐品种配置。",
        ],
    },
    "conservation_tillage": {
        "id": "conservation_tillage",
        "name": "保育耕作",
        "description": "以减少扰动和保水稳土为核心，提高系统抗波动能力。",
        "speed": get_scenario_speed_mean("conservation_tillage"),
        "impacts": get_scenario_impacts_mean("conservation_tillage"),
        "default_actions": [
            "降低翻耕强度，优先少耕或免耕以减小结构破坏。",
            "增加地表覆盖，控制风蚀和水蚀风险。",
            "对坡位或易流失地块实施分区管理。",
        ],
    },
    "integrated_stable": {
        "id": "integrated_stable",
        "name": "综合稳产方案",
        "description": "统筹改土、控水、稳盐与保育措施，追求稳产与风险平衡。",
        "speed": get_scenario_speed_mean("integrated_stable"),
        "impacts": get_scenario_impacts_mean("integrated_stable"),
        "default_actions": [
            "按生育阶段配置水肥，避免早期和高温期管理波动。",
            "结合有机改良与覆盖管理，提升土壤基础与稳定性。",
            "对盐分敏感区执行分区灌排和作物配置策略。",
        ],
    },
}

COMPONENT_META: Dict[str, Dict[str, str]] = {
    "soil_norm": {"label": "土壤基础", "issue": "土壤基础偏弱"},
    "water_norm": {"label": "水分条件", "issue": "水分条件偏弱"},
    "salinity_norm": {"label": "盐分条件", "issue": "盐分约束偏强"},
    "stab_norm": {"label": "稳定性", "issue": "稳定性偏弱"},
    "prod_norm": {"label": "生产力", "issue": "生产力偏弱"},
    "terrain_norm": {"label": "地形条件", "issue": "地形约束偏强"},
}

OBJECTIVE_COMPONENT_BONUS: Dict[str, Dict[str, float]] = {
    "改土优先": {"soil_norm": 0.06, "stab_norm": 0.03, "salinity_norm": 0.02},
    "节水优先": {"water_norm": 0.08, "prod_norm": 0.03},
    "稳产优先": {"prod_norm": 0.07, "water_norm": 0.03, "salinity_norm": 0.02},
}

VALID_PLAN_TASK_TYPES = {"priority_actions", "stage_schedule", "risk_explain"}
VALID_PROGRESS_MODES = {"aggressive", "stable", "conservative"}

IRRIGATION_STRATEGY_TEXT: Dict[str, str] = {
    "充足": "灌溉条件较充足，但仍应避免一次性大水；优先采用分次补水，把保墒、控盐与关键期补水拆开执行。",
    "有限": "灌溉资源有限，应把水优先投向关键生育期与最弱分项，不做低效漫灌，并用覆盖管理减少蒸发损失。",
    "无": "当前按无灌溉约束执行，改善不能建立在补水上，重点转向覆盖保墒、减少扰动和耐逆配置。",
}


def default_objective(value: str | None) -> str:
    val = (value or "").strip()
    return val if val else "稳产优先"

def default_plan_task(value: str | None) -> str:
    task = str(value or "").strip().lower()
    return task if task in VALID_PLAN_TASK_TYPES else "priority_actions"


def default_constraints(payload: Dict[str, Any]) -> Dict[str, Any]:
    constraints = payload.get("constraints")
    if not isinstance(constraints, dict):
        constraints = {}
    irrigation = constraints.get("irrigation")
    if irrigation not in {"充足", "有限", "无"}:
        irrigation = "有限"
    return {"irrigation": irrigation}
def parse_progress_mode(payload: Dict[str, Any]) -> str:
    raw = str(payload.get("progress_mode") or "").strip().lower()
    if raw in VALID_PROGRESS_MODES:
        return raw
    return "stable"


def get_scenario_pack(pack_id: str | None) -> Dict[str, Any]:
    if not pack_id:
        return SCENARIO_PACKS["integrated_stable"]
    return SCENARIO_PACKS.get(pack_id, SCENARIO_PACKS["integrated_stable"])


def source_path(snapshot: Dict[str, Any], filename: str) -> str:
    region_id = str(snapshot.get("region_id", "xinjiang")).strip() or "xinjiang"
    baseline = snapshot.get("baseline_years")
    if isinstance(baseline, list) and len(baseline) >= 2:
        try:
            tag = f"{int(baseline[0])}_{int(baseline[1])}"
        except Exception:
            tag = "2010_2025"
    else:
        tag = "2010_2025"
    return f"data/features/shi_{region_id}/{filename.format(tag=tag)}"


def _safe_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _norm_score_text(value: float | None) -> str:
    if value is None:
        return "—"
    clipped = max(0.0, min(1.0, float(value)))
    return f"{int(round(clipped * 100))}/100"


def _recovery_target_text(value: float) -> str:
    if value < 0.35:
        return "45/100"
    if value < 0.5:
        return "50/100"
    return "60/100"


def _rank_focus_components(snapshot: Dict[str, Any], objective: str) -> tuple[list[Dict[str, Any]], list[Dict[str, Any]]]:
    components = snapshot.get("components", {})
    bonus = OBJECTIVE_COMPONENT_BONUS.get(objective, {})
    ranked: list[Dict[str, Any]] = []
    for key, meta in COMPONENT_META.items():
        value = _safe_float(components.get(key))
        if value is None:
            continue
        ranked.append(
            {
                "key": key,
                "label": meta["label"],
                "issue": meta["issue"],
                "value": value,
                "priority": (1.0 - value) + bonus.get(key, 0.0),
            }
        )
    ranked.sort(key=lambda item: (-item["priority"], item["value"], item["label"]))
    weak_items = [item for item in ranked if item["value"] < 0.6]
    if len(weak_items) >= 2:
        focus = weak_items[:2]
    else:
        focus = ranked[:2]
    return focus, ranked


def _focus_summary_text(focus_items: list[Dict[str, Any]]) -> str:
    if not focus_items:
        return "当前未见单一极弱分项"
    return "、".join([f"{item['label']} {_norm_score_text(item['value'])}" for item in focus_items])


def _component_diagnosis_hint(key: str) -> str:
    hints = {
        "prod_norm": "这说明作物长势代理偏弱；更稳妥的说法是建议优先排查水分波动、盐分约束、土壤结构和田间管理是否在共同压低生产表现。",
        "water_norm": "这说明有效水供给偏弱或波动较大；常见原因可能包括灌溉节奏不稳、覆盖不足和高蒸发损失。",
        "soil_norm": "这说明土壤基础偏弱；建议优先排查有机质、团聚体结构、地表覆盖和耕作扰动是否长期不足。",
        "salinity_norm": "这说明盐分约束偏强；常见情形是灌排节奏不匹配、蒸发偏强或高盐区没有分区管理。",
        "stab_norm": "这说明土壤系统稳定性不足；建议优先排查翻耕频次、覆盖管理和侵蚀扰动是否偏强。",
        "terrain_norm": "这说明地形限制较强；执行上更适合做分区管理，而不是全地块统一推进。",
    }
    return hints.get(key, "建议优先排查对应指标的田间约束与管理波动来源。")


def _format_rule_ids(rule_ids: list[str]) -> str:
    cleaned = [rule_id for rule_id in rule_ids if rule_id]
    return "、".join(cleaned) if cleaned else "规则库"


def _risk_actions(snapshot: Dict[str, Any], phase: int) -> list[str]:
    risk = snapshot.get("risk") if isinstance(snapshot.get("risk"), dict) else {}
    drought = _safe_float(risk.get("drought_risk"))
    heat = _safe_float(risk.get("heat_risk"))
    actions: list[str] = []
    if drought is not None and drought >= 0.5:
        drought_text = f"{int(round(drought * 100))}%"
        if phase == 1:
            actions.append(f"干旱风险较高（{drought_text}），高风险月份前置保墒与分次补水，避免土壤短时间失水过快。")
        elif phase == 2:
            actions.append(f"进入干旱高风险月前一周复核墒情；若仍反复失水，优先压缩无效蒸发而不是单纯加大水量。")
        else:
            actions.append("保留干旱预警触发机制，把应急保墒动作固化到常态巡检中。")
    if heat is not None and heat >= 0.5:
        heat_text = f"{int(round(heat * 100))}%"
        if phase == 1:
            actions.append(f"热胁迫风险较高（{heat_text}），高温时段优先早晚补水并保持地表覆盖，减少午后高温暴露。")
        elif phase == 2:
            actions.append("高温阶段把补水窗口前移，并同步检查覆盖完整性，避免温度和失水叠加。")
        else:
            actions.append("将高温期灌溉窗口与覆盖管理写入固定作业历，避免下一轮再临时应对。")
    return actions


def _component_phase_action(item: Dict[str, Any], phase: int, constraints: Dict[str, Any]) -> str:
    key = item["key"]
    score_text = _norm_score_text(item["value"])
    target_text = _recovery_target_text(float(item["value"]))
    irrigation = constraints.get("irrigation", "有限")
    if key == "soil_norm":
        if phase == 1:
            return f"把有机质回补、秸秆还田和地表覆盖放在同一套动作里，先把土壤基础从 {score_text} 拉回到 {target_text} 附近，再考虑扩展到增产动作。"
        if phase == 2:
            return f"按阶段复核土壤基础；若连续两轮仍低于 {target_text}，升级为“有机改良+保育耕作”联动，避免只补不护。"
        return "将还田、覆盖作物和少耕制度固化到下一季，防止土壤基础短期改善后再次回落。"
    if key == "water_norm":
        if phase == 1:
            if irrigation == "无":
                return f"当前无灌溉条件，先用覆盖和减少裸地蒸发稳住水分条件（当前 {score_text}），不能把回升寄托在补水上。"
            return f"把补水改成“分次+关键期优先”，先稳住水分条件 {score_text}，目标至少回到 {target_text}。"
        if phase == 2:
            return f"每轮联看水分条件与干旱风险；若高风险阶段仍反复跌破 {target_text}，缩短补水间隔并加强地表覆盖。"
        return "固定关键期补水窗口，保留干旱月份的应急保墒预案，避免再次出现大起大落。"
    if key == "salinity_norm":
        if phase == 1:
            return f"把控盐排盐与灌溉节奏一起设计，避免高蒸发时段集中灌溉；当前重点是先缓解盐分约束（{score_text}）。"
        if phase == 2:
            return "持续跟踪灌后和雨后盐分变化；若连续两轮仍无改善，应转为分区排盐或耐盐配置，而不是全地块一刀切。"
        return "将高盐敏感区单独建档管理，长期执行差异化灌排与作物配置。"
    if key == "stab_norm":
        if phase == 1:
            return f"先停高频深翻和重复碾压，优先少耕/免耕与覆盖，避免稳定性从 {score_text} 继续下滑。"
        if phase == 2:
            return f"在大风、高温或集中作业后复核稳定性；若仍低于 {target_text}，继续压减扰动频次并提高覆盖率。"
        return "把保育耕作固化进常规作业历，减少下一季再次破碎和结构回退。"
    if key == "prod_norm":
        if phase == 1:
            return f"当前生产力仅 {score_text}，先排查是否由水分、盐分或土壤基础拖累，不建议直接用高投入去硬拉产出。"
        if phase == 2:
            return "把生产力与土壤/水分分项联看，只有约束项回升后再讨论增产动作，避免表面提产、底层失稳。"
        return "将有效水肥与地力管理组合沉淀为稳产模板，确保生产力改善不是一次性波动。"
    if phase == 1:
        return f"对地形敏感位置单独管理，先稳土再谈增效；当前地形条件为 {score_text}。"
    if phase == 2:
        return "在强降雨或大风后复核易流失位置，必要时将坡位与平地拆开管理。"
    return "把易流失区长期纳入分区管理，避免统一作业导致局部退化反复出现。"


def _scenario_anchor_action(scenario_pack: Dict[str, Any], objective: str, focus_items: list[Dict[str, Any]]) -> str:
    focus_labels = {item["key"] for item in focus_items}
    if scenario_pack["id"] == "organic_boost":
        if "water_norm" in focus_labels:
            return f"虽然主线选择“{scenario_pack['name']}”，但不能只做改土；本轮必须把水分管理与有机质提升同步推进，否则 SHI 难明显回升。"
        return f"本轮以“{scenario_pack['name']}”作为主线，优先修复土壤基础和结构，再带动 SHI 回升。"
    if scenario_pack["id"] == "irrigation_opt":
        return f"本轮以“{scenario_pack['name']}”控住波动，先把最弱水分环节稳住，再谈扩展性投入。"
    if scenario_pack["id"] == "salt_control":
        return f"本轮以“{scenario_pack['name']}”优先压住盐碱约束，避免管理动作被次生盐渍化抵消。"
    if scenario_pack["id"] == "conservation_tillage":
        return f"本轮以“{scenario_pack['name']}”减少人为扰动，先保结构、保墒，再推进其他分项改善。"
    return f"本轮采用“{scenario_pack['name']}”，围绕“{objective}”先集中资源处理最弱两项，其余分项维持稳态。"


def _scenario_escalation_action(scenario_pack: Dict[str, Any], focus_items: list[Dict[str, Any]]) -> str:
    focus_labels = {item["key"] for item in focus_items}
    if scenario_pack["id"] == "organic_boost" and "water_norm" in focus_labels:
        return "如果水分条件连续两轮仍未回到警戒线附近，需要在有机质提升之外叠加灌溉优化，否则方案会停留在“改土见效慢、SHI回升弱”。"
    if scenario_pack["id"] == "irrigation_opt" and "soil_norm" in focus_labels:
        return "如果补水优化后土壤基础仍弱，应叠加有机质提升，避免只稳水、不改土。"
    if scenario_pack["id"] == "salt_control" and "water_norm" in focus_labels:
        return "若控盐后水分条件仍弱，应同步调整保墒节奏，否则会出现“盐缓了、水又掉下去”的反复。"
    return "若最弱分项连续两轮没有改善，不要继续平均用力，应切换到“短板优先”的叠加策略。"


def _dedupe_lines(lines: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for line in lines:
        text = line.strip()
        if not text or text in seen:
            continue
        seen.add(text)
        deduped.append(text)
    return deduped


def build_rule_traces(snapshot: Dict[str, Any], scenario_pack: Dict[str, Any], constraints: Dict[str, Any]) -> list[RuleTrace]:
    components = snapshot["components"]
    risk = snapshot.get("risk") if isinstance(snapshot.get("risk"), dict) else {}
    drought_risk = risk.get("drought_risk")
    heat_risk = risk.get("heat_risk")
    traces: list[RuleTrace] = [
        RuleTrace(
            rule_id=f"PACK_{scenario_pack['id'].upper()}",
            title=f"启用措施包：{scenario_pack['name']}",
            trigger="用户选择措施包",
            evidence=f"pack_id={scenario_pack['id']}",
            explanation=scenario_pack["description"],
            source="docs/土壤健康DSS方案.md#3-推荐策略",
        )
    ]
    if components["soil_norm"] is not None and components["soil_norm"] < 0.45:
        traces.append(
            RuleTrace(
                rule_id="R_SOIL_LOW_01",
                title="土壤基础偏弱触发改土优先",
                trigger="soil_norm < 0.45",
                evidence=f"soil_norm={components['soil_norm']}",
                explanation="优先提升有机质与土壤结构，减缓退化。",
                source=source_path(snapshot, "shi_soil_norm_{tag}.tif"),
            )
        )
    if components["water_norm"] is not None and components["water_norm"] < 0.45:
        traces.append(
            RuleTrace(
                rule_id="R_WATER_STRESS_01",
                title="水分胁迫触发灌溉优化",
                trigger="water_norm < 0.45",
                evidence=f"water_norm={components['water_norm']}",
                explanation="采用分阶段灌溉管理，降低水分波动风险。",
                source=source_path(snapshot, "era5_rzsm_gs_mean_{tag}_on_modis.tif"),
            )
        )
    if components["salinity_norm"] is not None and components["salinity_norm"] < 0.5:
        traces.append(
            RuleTrace(
                rule_id="R_SALINITY_01",
                title="盐碱约束触发控盐排盐",
                trigger="salinity_norm < 0.50",
                evidence=f"salinity_norm={components['salinity_norm']}",
                explanation="优先安排控盐排盐与耐盐策略，防止次生盐渍化。",
                source=source_path(snapshot, "shi_salinity_norm_{tag}.tif"),
            )
        )
    if components["stab_norm"] is not None and components["stab_norm"] < 0.4:
        traces.append(
            RuleTrace(
                rule_id="R_STABILITY_01",
                title="稳定性偏弱触发保育耕作",
                trigger="stab_norm < 0.40",
                evidence=f"stab_norm={components['stab_norm']}",
                explanation="通过减少扰动和覆盖管理提升系统抗波动能力。",
                source=source_path(snapshot, "shi_stab_norm_{tag}.tif"),
            )
        )
    if constraints.get("irrigation") == "无":
        traces.append(
            RuleTrace(
                rule_id="R_CONSTRAINT_IRRIGATION_NONE",
                title="无灌溉约束触发耐逆策略",
                trigger="constraints.irrigation == 无",
                evidence="灌溉条件=无",
                explanation="优先耐逆作物配置与保墒措施，避免高耗水方案。",
                source="docs/土壤健康DSS方案.md#31-长期建议",
            )
        )
    if isinstance(drought_risk, (int, float)) and drought_risk >= 0.5:
        traces.append(
            RuleTrace(
                rule_id="R_DROUGHT_01",
                title="干旱风险偏高触发保墒方案",
                trigger="drought_risk >= 0.50",
                evidence=f"drought_risk={drought_risk}",
                explanation="建议高风险月份优先保墒与分次灌溉，降低土壤失水风险。",
                source=source_path(snapshot, "era5_drought_risk_gs_{tag}_on_modis.tif"),
            )
        )
    if isinstance(heat_risk, (int, float)) and heat_risk >= 0.5:
        traces.append(
            RuleTrace(
                rule_id="R_HEAT_01",
                title="热胁迫风险偏高触发高温期管理",
                trigger="heat_risk >= 0.50",
                evidence=f"heat_risk={heat_risk}",
                explanation="建议高温时段优化灌溉窗口并加强覆盖降温，减少热胁迫损失。",
                source=source_path(snapshot, "era5_heat_risk_gs_{tag}_on_modis.tif"),
            )
        )
    return traces


def build_plan_stages(
    snapshot: Dict[str, Any],
    scenario_pack: Dict[str, Any],
    objective: str,
    constraints: Dict[str, Any],
    rule_traces: list[RuleTrace],
) -> list[PlanStage]:
    irrigation = constraints.get("irrigation", "有限")
    focus_items, _ = _rank_focus_components(snapshot, objective)
    focus_text = _focus_summary_text(focus_items)
    stage1_actions = [
        f"优先关注项：{focus_text}；本阶段先稳住相对较弱项，并避免其继续拖累整体评分。",
        f"目标对齐：{objective}，按地块建立执行台账与周度复盘，记录最弱分项是否退出低值区间。",
        _scenario_anchor_action(scenario_pack, objective, focus_items),
        IRRIGATION_STRATEGY_TEXT.get(irrigation, IRRIGATION_STRATEGY_TEXT["有限"]),
    ]
    stage1_actions.extend([_component_phase_action(item, 1, constraints) for item in focus_items])
    stage1_actions.extend(_risk_actions(snapshot, 1))

    stage2_actions = [
        f"按阶段复核 {focus_text} 与 SHI 总分，优先看最弱分项是否回到警戒线附近，而不是只盯总分波动。",
        _scenario_escalation_action(scenario_pack, focus_items),
        "对风险高或恢复慢的地块建立分区策略，避免一刀切管理。",
    ]
    stage2_actions.extend([_component_phase_action(item, 2, constraints) for item in focus_items])
    stage2_actions.extend(_risk_actions(snapshot, 2))

    stage3_actions = [
        f"对比基线与执行后分项曲线，重点确认 {focus_text} 是否稳定退出低值区间，再决定是否固化方案。",
        "把已验证有效的动作沉淀为分区模板，进入常态化巡检并保留异常快速响应机制。",
    ]
    stage3_actions.extend([_component_phase_action(item, 3, constraints) for item in focus_items])
    stage3_actions.extend(_risk_actions(snapshot, 3))

    weakest_label = focus_items[0]["label"] if focus_items else "关键分项"
    second_label = focus_items[1]["label"] if len(focus_items) > 1 else "次级分项"
    stage1_expected = [
        f"{weakest_label}与{second_label}先止跌，避免继续拉低 SHI。",
        "完成从“短板识别”到“针对性执行”的闭环。",
    ]
    stage2_expected = [
        f"{weakest_label}逐步回到警戒线附近，SHI 改善不再只靠单月波动。",
        "风险高区域进入可控节奏，开始形成分区管理依据。",
    ]
    stage3_expected = [
        f"{weakest_label}和{second_label}退出持续低值区间，SHI 进入稳定改善轨道。",
        "形成可解释、可复核、可复制的地块管理模板。",
    ]

    all_rule_ids = [rule.rule_id for rule in rule_traces]
    return [
        PlanStage(
            stage_id="phase_1",
            title="第一阶段：止跌稳态",
            actions=_dedupe_lines(stage1_actions),
            expected_changes=stage1_expected,
            rule_ids=all_rule_ids[: max(1, min(3, len(all_rule_ids)))],
            milestones=[
                f"{weakest_label}不再继续下探，且风险不再放大。",
                "最弱分项回到警戒线附近，具备进入下一阶段的基础。",
            ],
            entry_conditions=[
                "当前最弱分项仍明显拖累整体评分，需要先止跌。",
                "当前动作应以稳态、防止继续恶化为优先。",
            ],
            exit_conditions=[
                f"{weakest_label}回到警戒线以上或接近警戒线。",
                "高风险提示不再持续升级。",
            ],
            fallback_actions=[
                "若连续两轮复核仍无改善，优先升级最弱分项对应动作。",
                "必要时叠加灌排、控盐或覆盖管理，不再平均用力。",
            ],
        ),
        PlanStage(
            stage_id="phase_2",
            title="第二阶段：补主分",
            actions=_dedupe_lines(stage2_actions),
            expected_changes=stage2_expected,
            rule_ids=all_rule_ids[: max(1, min(4, len(all_rule_ids)))],
            milestones=[
                f"{weakest_label}与{second_label}逐步进入稳态区间。",
                "方案效果不再依赖单一动作支撑。",
            ],
            entry_conditions=[
                "第一阶段已止跌，当前重点转向主分提升。",
                "当前允许围绕最弱项与次弱项做组合干预。",
            ],
            exit_conditions=[
                f"{weakest_label}和{second_label}进入相对稳定区间。",
                "风险处于可控节奏，且主分提升趋势稳定。",
            ],
            fallback_actions=[
                "若次弱项开始反复波动，应调整为短板优先的叠加方案。",
                "若风险重新放大，应回退到稳态优先而非继续加码增效。",
            ],
        ),
        PlanStage(
            stage_id="phase_3",
            title="第三阶段：巩固复制",
            actions=_dedupe_lines(stage3_actions),
            expected_changes=stage3_expected,
            rule_ids=all_rule_ids[:],
            milestones=[
                "当前方案具备稳定保持和复制参考价值。",
                "重点分项保持高位，不出现明显回落。",
            ],
            entry_conditions=[
                "主分已进入稳态区间，可转入巩固与模板化。",
                "当前重点从补短板转为防回落和可复制。",
            ],
            exit_conditions=[
                "形成可持续执行的管理模板。",
                "连续复核仍保持稳定，不再依赖临时补救动作。",
            ],
            fallback_actions=[
                "若关键分项再次回落，退回上一阶段重新补主分。",
                "若风险重新升高，优先恢复对应稳态动作而不是继续扩展目标。",
            ],
        ),
    ]


def build_plan_summary(snapshot: Dict[str, Any], scenario_pack: Dict[str, Any], objective: str) -> str:
    focus_items, _ = _rank_focus_components(snapshot, objective)
    focus_text = _focus_summary_text(focus_items)
    risk = snapshot.get("risk") if isinstance(snapshot.get("risk"), dict) else {}
    risk_level = str(risk.get("risk_level") or "").strip()
    risk_clause = f"当前综合风险等级为{risk_level}。" if risk_level else ""
    return (
        f"当前地块 SHI={snapshot['shi_score']}（{snapshot['shi_level']}），重点关注项为{focus_text}；"
        f"建议以“{scenario_pack['name']}”为主线，围绕“{objective}”优先处理这些限制项。{risk_clause}"
    )


def build_plan_payload(
    snapshot: Dict[str, Any],
    scenario_pack: Dict[str, Any],
    objective: str,
    constraints: Dict[str, Any],
    task_type: str = "priority_actions",
    progress_mode: str = "stable",
) -> Dict[str, Any]:
    normalized_task_type = default_plan_task(task_type)
    normalized_progress_mode = progress_mode if progress_mode in VALID_PROGRESS_MODES else "stable"
    rule_traces = build_rule_traces(snapshot, scenario_pack, constraints)
    stages = build_plan_stages(snapshot, scenario_pack, objective, constraints, rule_traces)
    summary = build_plan_summary(snapshot, scenario_pack, objective)
    uncertainty_note = "本方案基于历史统计、规则触发和当前约束生成，适合做区域研判与管理参考，不替代实时监测、田间试验和专家复核。"
    return {
        "goal": objective,
        "constraints": constraints,
        "progress_mode": normalized_progress_mode,
        "task_type": normalized_task_type,
        "scenario_pack": {
            "id": scenario_pack["id"],
            "name": scenario_pack["name"],
            "description": scenario_pack["description"],
        },
        "summary": summary,
        "stages": [stage.to_dict() for stage in stages],
        "rule_traces": [rule.to_dict() for rule in rule_traces],
        "uncertainty_note": uncertainty_note,
    }


def _task_type_prompt(task_type: str) -> str:
    if task_type == "stage_schedule":
        return (
            "请把回答组织成阶段安排，按“先做什么 / 什么时候复核 / 触发什么条件时调整”展开，"
            "避免只给笼统建议。"
        )
    if task_type == "risk_explain":
        return (
            "请围绕当前最主要风险展开，说明为什么它会拖累当前 profile 评分、"
            "现在先做什么，以及后续如何复核。"
        )
    return (
        "请先给出 1 到 3 条最值得优先执行的动作，再补充 1 到 2 条复核建议和 3 到 4 个简洁理由，"
        "保持表达直接、可执行。"
    )


def build_llm_messages_for_plan(
    plan_payload: Dict[str, Any],
    snapshot: Dict[str, Any],
    knowledge_context: str | None = None,
) -> list[Dict[str, str]]:
    task_type = default_plan_task(plan_payload.get("task_type"))
    sys_prompt = (
        "你是 SoilSight 规划工作台助手。你会基于 snapshot 和 plan 生成可直接展示给评委或用户的中文说明。"
        "输出纯中文，不要 Markdown 加粗。"
        "不要发明新事实，只能依据 snapshot、rule_traces 和 scenario_pack 解释。"
        "如果需要做推断，只能写成“建议优先排查”或“常见原因可能是”，不能写成已知事实。"
        "回答必须紧扣当前地块最弱分项、风险与约束，并给出可执行步骤。"
        + _task_type_prompt(task_type)
    )
    user_prompt = json.dumps({"snapshot": snapshot, "plan": plan_payload}, ensure_ascii=False)
    messages = [{"role": "system", "content": sys_prompt}]
    if knowledge_context:
        messages.append({"role": "system", "content": knowledge_context})
    messages.append({"role": "user", "content": user_prompt})
    return messages


def build_llm_messages_for_chat(
    session: PlanSession,
    user_message: str,
    knowledge_context: str | None = None,
) -> list[Dict[str, str]]:
    sys_prompt = (
        "你是土壤健康DSS对话助手。你必须基于已有计划与规则解释回答，"
        "不能给出精确药剂/施肥剂量。输出中文纯文本，不要 Markdown 加粗。"
        "不要过度压缩，除非用户明确要求简答，否则优先按“直接结论 / 原因链 / 执行建议 / 触发依据”的结构回答。"
        "必须紧扣当前地块最弱分项、风险和约束，不要泛泛而谈。"
        "如果原因并非 snapshot 或 rule 中直接给出，只能写成“常见原因可能是”或“建议优先排查”，不能写成已知事实。"
        "允许给出阶段动作、复核节点和调整条件，但不要超出当前计划口径。"
        "回答末尾如需引用依据，必须写成“依据：<真实rule_id>”；若当前问题不需要列依据，则不要输出“依据”字段，更不要输出 rule_id 这类占位词。"
    )
    payload = {
        "snapshot": session.snapshot,
        "plan_summary": session.plan.get("summary"),
        "scenario_pack": session.plan.get("scenario_pack"),
        "rule_traces": session.plan.get("rule_traces", []),
        "last_chat": session.chat_history[-4:],
        "user_message": user_message,
    }
    messages = [{"role": "system", "content": sys_prompt}]
    if knowledge_context:
        messages.append({"role": "system", "content": knowledge_context})
    messages.append({"role": "user", "content": json.dumps(payload, ensure_ascii=False)})
    return messages


def sanitize_llm_reply(text: str) -> str:
    cleaned = str(text or '').strip()
    if not cleaned:
        return ''
    placeholders = [
        '依据：rule_id',
        '依据:rule_id',
        '依据： rule_id',
        '依据: rule_id',
        '触发依据：rule_id',
        '触发依据:rule_id',
        '触发依据： rule_id',
        '触发依据: rule_id',
    ]
    for token in placeholders:
        cleaned = cleaned.replace(token, '')
    while '  ' in cleaned:
        cleaned = cleaned.replace('  ', ' ')
    cleaned = cleaned.replace(' 。', '。').replace(' ，', '，').replace(' ；', '；').replace(' :', ':')
    return cleaned.strip()


def build_llm_messages_for_general_chat(
    chat_history: list[Dict[str, str]],
    user_message: str,
    knowledge_context: str | None = None,
) -> list[Dict[str, str]]:
    sys_prompt = (
        "你是 SoilSight 的农业与土壤健康助手。"
        "你可以回答土壤健康、耕地管理、灌溉、水分胁迫、盐碱治理、干旱风险、热胁迫和新疆农业相关问题。"
        "若用户询问具体地块方案，但当前没有地块上下文，你必须明确提示其从地图进入规划工作台并带入地块上下文。"
        "不要编造监测数据，不给出精确药剂或施肥剂量。输出中文，简洁、实用、便于答辩表达。"
    )
    messages: list[Dict[str, str]] = [{"role": "system", "content": sys_prompt}]
    for item in chat_history[-8:]:
        role = str(item.get("role", "")).strip()
        content = str(item.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            messages.append({"role": role, "content": content})
    if knowledge_context:
        messages.append({"role": "system", "content": knowledge_context})
    messages.append({"role": "user", "content": user_message})
    return messages


def build_plan_chat_history(chat_history: list[Dict[str, str]], assistant_reply: str) -> list[Dict[str, str]]:
    normalized: list[Dict[str, str]] = []
    for item in chat_history[-20:]:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "")).strip()
        content = str(item.get("content", "")).strip()
        if role in {"user", "assistant"} and content:
            normalized.append({"role": role, "content": content})
    reply = str(assistant_reply or "").strip()
    if not reply:
        return normalized
    if normalized and normalized[0].get("role") == "assistant" and normalized[0].get("content") == reply:
        return normalized
    return ([{"role": "assistant", "content": reply}] + normalized)[-20:]


def fallback_plan_text(plan_payload: Dict[str, Any]) -> str:
    task_type = default_plan_task(plan_payload.get("task_type"))
    stages = plan_payload.get("stages", [])
    rule_traces = [rule for rule in plan_payload.get("rule_traces", []) if isinstance(rule, dict)]
    summary = str(plan_payload.get("summary", "")).strip()

    stage_blocks: list[str] = []
    for stage in stages:
        actions = [f"- {action}" for action in stage.get("actions", []) if action]
        expected = [f"- 预期变化：{item}" for item in stage.get("expected_changes", [])[:2] if item]
        body = "\n".join(actions + expected).strip()
        if body:
            stage_blocks.append(f"{stage.get('title', '')}\n{body}")

    trace_lines = []
    for rule in rule_traces[:4]:
        rule_id = str(rule.get("rule_id", "")).strip()
        explanation = str(rule.get("explanation", "")).strip()
        if rule_id and explanation:
            trace_lines.append(f"- {rule_id}：{explanation}")

    if task_type == "stage_schedule":
        sections = [
            "阶段安排",
            summary,
            "分阶段动作",
            "\n\n".join(stage_blocks) if stage_blocks else "当前暂无阶段动作。",
            "触发依据",
            "\n".join(trace_lines) if trace_lines else "- 当前未记录额外规则触发。",
        ]
        return "\n\n".join([section for section in sections if section])

    if task_type == "risk_explain":
        risk_trace = next((line for line in trace_lines if "DROUGHT" in line or "HEAT" in line), None)
        support_trace = trace_lines[0] if trace_lines else "- 当前未记录额外规则触发。"
        risk_reason = risk_trace or support_trace
        risk_label = "干旱风险" if "DROUGHT" in risk_reason else ("热胁迫风险" if "HEAT" in risk_reason else "当前综合风险")
        actions = stages[0].get("actions", [])[:2] if stages else []
        action_lines = "\n".join([f"- {action}" for action in actions]) if actions else "- 当前暂无可展开的优先动作。"
        sections = [
            "当前主要风险",
            f"当前需要优先处理的是{risk_label}，因为它会持续拖累最弱分项并压低 SHI。",
            "为什么先处理",
            summary,
            "现在先做什么",
            action_lines,
            "触发依据",
            risk_reason,
        ]
        return "\n\n".join([section for section in sections if section])

    top_actions: list[str] = []
    if stages:
        top_actions = [action for action in stages[0].get("actions", []) if action][:3]
    action_lines = "\n".join([f"- {action}" for action in top_actions]) if top_actions else "- 当前暂无可展开的优先动作。"
    follow_ups = [
        "- 每轮复核最弱分项是否退出低值区间。",
        "- 若连续两轮无改善，升级为短板优先的叠加方案。",
        "- 记录风险月份与管理动作，为下一轮调整保留依据。",
    ]
    sections = [
        "优先动作",
        action_lines,
        "当前判断",
        summary,
        "后续跟踪",
        "\n".join(follow_ups),
    ]
    return "\n\n".join([section for section in sections if section])


def fallback_chat_reply(session: PlanSession, user_message: str) -> str:
    lower_msg = user_message.lower()
    traces = session.plan.get("rule_traces", [])
    rule_ids = [trace.get("rule_id") for trace in traces if isinstance(trace, dict) and trace.get("rule_id")]
    risk_traces = [
        trace for trace in traces if isinstance(trace, dict) and trace.get("rule_id") in {"R_DROUGHT_01", "R_HEAT_01"}
    ]
    risk_rule_ids = [trace.get("rule_id") for trace in risk_traces if trace.get("rule_id")]
    focus_items, _ = _rank_focus_components(session.snapshot, session.objective)
    scenario_pack = session.plan.get("scenario_pack", {}) if isinstance(session.plan.get("scenario_pack"), dict) else {}
    scenario_name = str(scenario_pack.get("name") or session.scenario_pack_id)
    irrigation = str(session.plan.get("constraints", {}).get("irrigation") or session.constraints.get("irrigation") or "有限")
    focus_detail = "、".join([f"{item['label']}（{_norm_score_text(item['value'])}）" for item in focus_items]) if focus_items else "当前关键分项"
    if ("短板" in user_message) or (("为什么" in user_message or "why" in lower_msg) and any(token in user_message for token in ["这两项", "两项", "分项"])):
        lines = [
            f"当前优先关注项是{focus_detail}。之所以先看这两项，是因为它们是当前分项里相对较弱的部分，继续下探会先拖累 SHI 主分。",
        ]
        for item in focus_items[:2]:
            lines.append(f"{item['label']} {_norm_score_text(item['value'])}：{_component_diagnosis_hint(item['key'])}")
        lines.append(
            f"执行上不建议把这两个短板拆开分别处理。当前更合适的是沿着“{scenario_name}”先稳住最弱项，再同步处理次弱项，避免一项刚回升、另一项继续拖累整体得分。"
        )
        lines.append(f"灌溉条件按“{irrigation}”处理，因此动作设计要围绕可执行的补水节奏、覆盖管理和分区复核来安排。")
        lines.append(f"依据：{_format_rule_ids(rule_ids[:3])}")
        return "\n".join(lines)
    if ("依据" in user_message) or ("why" in lower_msg):
        prioritized = risk_traces + [trace for trace in traces if trace not in risk_traces]
        details = [f"{trace.get('rule_id')}: {trace.get('explanation')}" for trace in prioritized[:3]]
        return "当前建议主要依据如下：\n" + "\n".join(details) if details else "当前建议依据为规则引擎触发记录。"
    if ("风险" in user_message) or ("risk" in lower_msg):
        if risk_traces:
            lines = [f"{trace.get('rule_id')}: {trace.get('explanation')}" for trace in risk_traces]
            return "当前重点气象风险：\n" + "\n".join(lines) + f"\n依据：{_format_rule_ids(risk_rule_ids)}"
        return f"{session.plan.get('uncertainty_note', '')} 重点风险：执行不连续、灌溉约束变化、盐分反弹。依据：{_format_rule_ids(rule_ids[:2])}"
    if any(token in user_message for token in ["怎么做", "实施", "详细", "可执行", "规划", "先做什么"]):
        lines = [f"当前更适合按“{scenario_name}”推进，先处理{focus_detail}。"]
        for stage in session.plan.get("stages", [])[:3]:
            title = str(stage.get("title", "")).strip()
            actions = [f"- {action}" for action in stage.get("actions", [])[:3] if action]
            if title:
                lines.append(title)
            lines.extend(actions)
        lines.append(f"复核时重点盯住最弱分项是否回到警戒线附近；若连续两轮无改善，就需要加码或调整动作组合。")
        lines.append(f"依据：{_format_rule_ids(rule_ids[:3])}")
        return "\n".join(lines)
    if risk_traces:
        return f"建议优先处理气象极端风险，再按既定方案推进，并同步复核最弱分项是否止跌。依据：{_format_rule_ids(risk_rule_ids)}"
    return f"建议继续按当前方案分阶段执行，先抓{focus_detail}，并在每轮复核中跟踪分项变化。依据：{_format_rule_ids(rule_ids[:2])}"


def fallback_general_chat_reply(chat_history: list[Dict[str, str]], user_message: str) -> str:
    _ = chat_history
    lower_msg = user_message.lower()
    if any(token in user_message for token in ["当前地块", "这个地块", "该地块", "这个点位", "这个像元"]):
        return "如果你要针对具体地块生成评估或规划，请先从地图点击地块后进入规划工作台并带入地块上下文，这样我才能结合 SHI、风险和分项短板给出针对性建议。"
    if any(token in user_message for token in ["盐碱", "盐渍化", "控盐", "排盐"]):
        return (
            "盐碱地治理通常先抓三件事：一是稳住灌排节奏，避免高蒸发时段集中灌水；"
            "二是配合有机质回补，提升土壤缓冲与保水能力；三是对高盐区分区管理，必要时采用耐盐作物或品种。"
        )
    if any(token in user_message for token in ["有机质", "秸秆", "覆盖作物", "改土"]):
        return (
            "提升有机质的核心价值在于同时改善土壤结构、保水性和缓冲能力。"
            "比赛展示时可以强调：它不是单一增肥动作，而是为 SHI 的土壤基础和稳定性分项打底。"
        )
    if any(token in user_message for token in ["灌溉", "水分", "保墒", "墒情"]):
        return (
            "水分管理更重要的是“节奏”而不是单次水量。一般建议优先保障关键期补水、减少一次性大水漫灌，"
            "并配合覆盖管理压缩无效蒸发，这样更容易稳定水分条件分项。"
        )
    if any(token in user_message for token in ["干旱", "热胁迫", "高温", "极端天气"]):
        return (
            "面对干旱和热胁迫，建议把管理重点放在前置保墒、分次补水和地表覆盖上。"
            "如果是答辩表述，可以概括为：通过降低水分波动和高温暴露，减少极端气候对土壤健康的持续拉低。"
        )
    if any(token in user_message for token in ["新疆", "绿洲农业", "棉花", "小麦", "玉米"]):
        return (
            "新疆农业管理通常要同时考虑绿洲灌溉依赖、盐渍化风险和高温干旱背景。"
            "因此比赛展示里更适合强调“宏观分区治理 + 地块差异化管理”，而不是单一增产措施。"
        )
    if ("shi" in lower_msg) or ("土壤健康" in user_message):
        return (
            "SHI 可以理解为把生产力、稳定性、土壤基础和水分条件统一到一个可比较的健康分值。"
            "如果你需要，我可以继续帮你把这个指标解释整理成适合答辩的口径。"
        )
    return (
        "我可以继续回答土壤健康、灌溉管理、盐碱治理、干旱风险、热胁迫和新疆农业相关问题。"
        "如果你想讨论具体地块，请从地图进入规划工作台并带入地块上下文。"
    )
