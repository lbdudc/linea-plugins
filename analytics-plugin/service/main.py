import inspect
import os
import re
import tempfile
import time
import warnings
from contextlib import asynccontextmanager
from typing import Any, Optional

warnings.filterwarnings("ignore")

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from flamapy.interfaces.python.flamapy_feature_model import FLAMAFeatureModel
from flamapy.core.discover import DiscoverMetamodels

SKIP_ENUM = 30   # full enumeration is exponential; skip above this threshold
SKIP_BDD  = 100  # BDD diagrams grow exponentially; skip above this threshold

UVL_GROUP_KEYWORDS = {"mandatory", "optional", "alternative", "or", "features", "constraints"}

_WARMUP_UVL = "features\n    Root\n        mandatory\n            A\n            B\n"


# ── Startup warmup ───────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app_: "FastAPI"):
    t0 = time.perf_counter()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".uvl", delete=False, encoding="utf-8") as f:
        f.write(_WARMUP_UVL)
        wp = f.name
    try:
        fm = FLAMAFeatureModel(wp)
        fm.core_features()
        dm = DiscoverMetamodels()
        model_fm = dm.use_transformation_t2m(wp, "fm")
        dm.use_transformation_m2m(model_fm, "pysat")
    finally:
        os.unlink(wp)
    print(f"[flamapy] warmup done in {(time.perf_counter()-t0)*1000:.0f}ms")
    yield


app = FastAPI(title="Flamapy REST API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Feature count estimation ─────────────────────────────────────────────────

def estimate_feature_count(uvl: str) -> int:
    in_constraints = False
    count = 0
    for line in uvl.split("\n"):
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("//") or trimmed.startswith("#"):
            continue
        if trimmed == "constraints":
            in_constraints = True
            continue
        if in_constraints:
            continue
        if trimmed == "features":
            continue
        indent = len(line) - len(line.lstrip())
        if indent >= 2:
            name = re.split(r"[\s{[]", trimmed)[0]
            if name and name not in UVL_GROUP_KEYWORDS:
                count += 1
    return count


# ── JSON serialization ───────────────────────────────────────────────────────

def to_serializable(obj: Any) -> Any:
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (int, float)):
        return obj
    if isinstance(obj, str):
        return obj
    if isinstance(obj, (list, tuple)):
        return [to_serializable(x) for x in obj]
    if isinstance(obj, set):
        return sorted(to_serializable(x) for x in obj)
    if isinstance(obj, dict):
        return {str(k): to_serializable(v) for k, v in obj.items()}
    if hasattr(obj, "__iter__"):
        return [to_serializable(x) for x in obj]
    if hasattr(obj, "__dict__"):
        d = {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
        if d:
            return {str(k): to_serializable(v) for k, v in d.items()}
    return str(obj)


# ── Safe wrapper ─────────────────────────────────────────────────────────────

def safe(fn, label: str, fallback=None):
    try:
        t0 = time.perf_counter()
        result = fn()
        print(f"  [ok]  {label:<44} {(time.perf_counter()-t0)*1000:.0f}ms")
        return to_serializable(result)
    except Exception as exc:
        print(f"  [err] {label:<44} {type(exc).__name__}: {exc}")
        return fallback


# ── Content normalisation ────────────────────────────────────────────────────

def normalize_uvl(text: str) -> str:
    """Normalize line endings and expand tabs so flamapy always gets clean input.

    Monaco on Windows may produce CRLF; Shift+Tab removes \\t while Tab re-adds
    spaces, leaving mixed tabs+spaces that confuse the flamapy parser but are
    accepted by the UVLS language server. Normalising here fixes both cases.
    """
    text = text.strip().replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(line.expandtabs(4) for line in text.split("\n"))


# ── Parse validation ─────────────────────────────────────────────────────────

def assert_parseable(uvl_path: str) -> None:
    """Raise HTTP 400 if the UVL file cannot be parsed by flamapy."""
    try:
        dm = DiscoverMetamodels()
        dm.use_transformation_t2m(uvl_path, "fm")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"UVL parse error: {exc}")


# ── Analysis helpers (parse once, reuse model) ────────────────────────────────

def run_structural(uvl_path: str) -> dict:
    fm = FLAMAFeatureModel(uvl_path)
    results = {}
    for op_name, key in [
        ("core_features",                       "coreFeatures"),
        ("average_branching_factor",             "averageBranchingFactor"),
        ("max_depth",                            "maxDepth"),
        ("estimated_number_of_configurations",   "estimatedConfigurations"),
        ("count_leafs",                          "leafNumber"),
        ("leaf_features",                        "leafFeatures"),
        ("atomic_sets",                          "atomicSets"),
    ]:
        method = getattr(fm, op_name)
        sig = inspect.signature(method)
        if "with_sat" in sig.parameters:
            results[key] = safe(lambda m=method: m(with_sat=True), op_name)
        else:
            results[key] = safe(method, op_name)
    return results


def run_enumeration(uvl_path: str) -> Any:
    fm = FLAMAFeatureModel(uvl_path)
    return safe(fm.configurations, "configurations")


def run_pysat_ops(uvl_path: str, ops: list[tuple[str, str]]) -> dict:
    dm = DiscoverMetamodels()
    fm_model = dm.use_transformation_t2m(uvl_path, "fm")
    model = dm.use_transformation_m2m(fm_model, "pysat")
    results = {}
    for op_name, key in ops:
        def _run(dm_=dm, model_=model, op_=op_name):
            op = dm_.get_operation(model_, "PySAT" + op_)
            op.execute(model_)
            return op.get_result()
        results[key] = safe(_run, "PySAT" + op_name)
    return results


def run_bdd_ops(uvl_path: str, ops: list[tuple[str, str]]) -> dict:
    dm = DiscoverMetamodels()
    fm_model = dm.use_transformation_t2m(uvl_path, "fm")
    model = dm.use_transformation_m2m(fm_model, "bdd")
    results = {}
    for op_name, key in ops:
        def _run(dm_=dm, model_=model, op_=op_name):
            op = dm_.get_operation(model_, "BDD" + op_)
            op.execute(model_)
            return op.get_result()
        results[key] = safe(_run, "BDD" + op_name)
    return results


# ── Request models ───────────────────────────────────────────────────────────

class AnalyzeRequest(BaseModel):
    uvl: str
    mode: str = "BDD"


class MetricRequest(BaseModel):
    uvl: str
    mode: str = "BDD"


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    """Fast path: structural + PySAT only. Always returns quickly regardless of model size."""
    uvl = normalize_uvl(req.uvl)
    if not uvl.startswith("features"):
        raise HTTPException(status_code=400, detail="UVL must start with 'features'")

    t_start = time.perf_counter()
    feature_count = estimate_feature_count(uvl)
    use_sat = req.mode == "SAT"
    model_size = (
        "small"      if feature_count < 50  else
        "medium"     if feature_count < 100 else
        "large"      if feature_count < 250 else
        "very_large"
    )

    with tempfile.NamedTemporaryFile(mode="w", suffix=".uvl", delete=False, encoding="utf-8") as f:
        f.write(uvl)
        uvl_path = f.name

    try:
        assert_parseable(uvl_path)
        print(f"[analyze] {model_size} — {feature_count} features — {'SAT' if use_sat else 'BDD'}")

        t = time.perf_counter()
        structural = run_structural(uvl_path)
        print(f"  structural: {(time.perf_counter()-t)*1000:.0f}ms")

        t = time.perf_counter()
        sat_results = run_pysat_ops(uvl_path, [
            ("Satisfiable",           "satisfiable"),
            ("DeadFeatures",          "deadFeatures"),
            ("FalseOptionalFeatures", "falseOptionalFeatures"),
        ])
        print(f"  SAT: {(time.perf_counter()-t)*1000:.0f}ms")

        elapsed = time.perf_counter() - t_start
        print(f"[analyze] done in {elapsed*1000:.0f}ms")

        return {
            **structural,
            "satisfiable":           sat_results.get("satisfiable"),
            "deadFeatures":          sat_results.get("deadFeatures"),
            "falseOptionalFeatures": sat_results.get("falseOptionalFeatures"),
            "_featureCount":         feature_count,
            "_modelSize":            model_size,
            "_solveMode":            "SAT" if use_sat else "BDD",
            "_skipped":              [],
            "_elapsedMs":            round(elapsed * 1000),
        }
    finally:
        os.unlink(uvl_path)


@app.post("/analyze/bdd")
def analyze_bdd(req: AnalyzeRequest):
    """Slow path: BDD group + enumeration. Intended to be called in the background."""
    uvl = normalize_uvl(req.uvl)
    if not uvl.startswith("features"):
        raise HTTPException(status_code=400, detail="UVL must start with 'features'")

    t_start = time.perf_counter()
    feature_count = estimate_feature_count(uvl)
    skipped: list[str] = []

    with tempfile.NamedTemporaryFile(mode="w", suffix=".uvl", delete=False, encoding="utf-8") as f:
        f.write(uvl)
        uvl_path = f.name

    try:
        assert_parseable(uvl_path)
        print(f"[analyze/bdd] {feature_count} features")

        BDD_FIELDS = ["configsNumber", "configDistribution", "featureInclusionProb",
                      "homogeneity", "variability", "uniqueFeatures", "variantFeatures"]

        if feature_count >= SKIP_BDD:
            skipped += ["configurations"] + BDD_FIELDS
            elapsed = time.perf_counter() - t_start
            print(f"[analyze/bdd] skipped (large model) in {elapsed*1000:.0f}ms")
            return {f: None for f in ["configurations"] + BDD_FIELDS} | {"_skipped": skipped, "_elapsedMs": round(elapsed * 1000)}

        configurations = None
        if feature_count <= SKIP_ENUM:
            t = time.perf_counter()
            configurations = run_enumeration(uvl_path)
            print(f"  enumeration: {(time.perf_counter()-t)*1000:.0f}ms")
        else:
            skipped.append("configurations")

        t = time.perf_counter()
        bdd_results = run_bdd_ops(uvl_path, [
            ("ConfigurationsNumber",        "configsNumber"),
            ("ProductDistribution",         "configDistribution"),
            ("FeatureInclusionProbability",  "featureInclusionProb"),
            ("Homogeneity",                  "homogeneity"),
            ("Variability",                  "variability"),
            ("UniqueFeatures",               "uniqueFeatures"),
            ("VariantFeatures",              "variantFeatures"),
        ])
        print(f"  BDD: {(time.perf_counter()-t)*1000:.0f}ms")

        elapsed = time.perf_counter() - t_start
        print(f"[analyze/bdd] done in {elapsed*1000:.0f}ms — skipped: {skipped or 'none'}")

        return {
            "configurations":       configurations,
            "configsNumber":        bdd_results.get("configsNumber"),
            "configDistribution":   bdd_results.get("configDistribution"),
            "featureInclusionProb": bdd_results.get("featureInclusionProb"),
            "homogeneity":          bdd_results.get("homogeneity"),
            "variability":          bdd_results.get("variability"),
            "uniqueFeatures":       bdd_results.get("uniqueFeatures"),
            "variantFeatures":      bdd_results.get("variantFeatures"),
            "_skipped":             skipped,
            "_elapsedMs":           round(elapsed * 1000),
        }
    finally:
        os.unlink(uvl_path)


@app.post("/analyze/metric")
def analyze_metric(metric: str, req: MetricRequest):
    uvl = normalize_uvl(req.uvl)
    if not uvl.startswith("features"):
        raise HTTPException(status_code=400, detail="UVL must start with 'features'")

    with tempfile.NamedTemporaryFile(mode="w", suffix=".uvl", delete=False, encoding="utf-8") as f:
        f.write(uvl)
        uvl_path = f.name

    try:
        assert_parseable(uvl_path)
        match metric:
            case "satisfiable":
                solver = "pysat" if req.mode == "SAT" else "bdd"
                results = run_pysat_ops(uvl_path, [("Satisfiable", "satisfiable")]) if solver == "pysat" \
                     else run_bdd_ops(uvl_path, [("Satisfiable", "satisfiable")])
                return {"satisfiable": results.get("satisfiable"), "_solveMode": req.mode}
            case "deadFeatures":
                results = run_pysat_ops(uvl_path, [("DeadFeatures", "deadFeatures")])
                return {"deadFeatures": results.get("deadFeatures"), "_solveMode": "SAT"}
            case "falseOptionalFeatures":
                results = run_pysat_ops(uvl_path, [("FalseOptionalFeatures", "falseOptionalFeatures")])
                return {"falseOptionalFeatures": results.get("falseOptionalFeatures"), "_solveMode": "SAT"}
            case _:
                raise HTTPException(status_code=400, detail=f"Unknown metric: {metric}")
    finally:
        os.unlink(uvl_path)
