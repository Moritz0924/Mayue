from dataclasses import dataclass
from typing import List, Dict

@dataclass
class BaselineResult:
    risk: str
    score: float
    note: str = "baseline"

def analyze_timeseries(series: List[Dict], threshold: float = 1.0) -> BaselineResult:
    """MVP baseline: 看最后一个值的绝对值是否超过阈值。"""
    if not series:
        return BaselineResult(risk="LOW", score=0.0, note="empty_series")
    v = float(series[-1]["v"])
    score = abs(v)
    if score > threshold * 2:
        return BaselineResult(risk="HIGH", score=score)
    if score > threshold:
        return BaselineResult(risk="MEDIUM", score=score)
    return BaselineResult(risk="LOW", score=score)
