"""Python port of backend/services/PerceptionTransform.js (perceptionToFloor + applyTransformToPoint).

Two entry points, because the archive comes in two shapes:
  raw_mqtt_to_venue(x, y, z)      MQTT payload position {x, y, z}  (perception frame)
  parquet_to_venue(px, pz)        parquet columns x, z   (x = perception X, z = perception Y; relabelled, NOT sign-flipped)
Both return venue-frame (x, z) in metres. Vectorised (numpy arrays accepted).
"""
from __future__ import annotations
import json, math
from pathlib import Path
import numpy as np

CFG_PATH = Path(__file__).resolve().parents[1] / "config" / "treviglio.json"


def load_transform(cfg_path: Path = CFG_PATH) -> dict:
    return json.loads(Path(cfg_path).read_text())["perception_transform"]


def perception_to_floor(input_frame: str, x, y_perc, z_perc):
    """MQTT {x,y,z} -> Three.js floor (x, z), height y. ros_rep103 flips the Y sign."""
    y_sign = -1.0 if input_frame == "ros_rep103" else 1.0
    return np.asarray(x, float), np.asarray(z_perc, float), y_sign * np.asarray(y_perc, float)


def apply_transform_to_point(t: dict, px, pz):
    """Three.js floor (px, pz) -> venue (x, z). Order: axis remap -> scale -> rotation -> mirror -> translate."""
    px = np.asarray(px, float); pz = np.asarray(pz, float)
    ax = pz if t["axis_map"]["px"] == "z" else px
    az = px if t["axis_map"]["py"] == "x" else pz
    s = float(t.get("scale", 1) or 1)
    sx, sz = ax * s, az * s
    rad = math.radians(float(t.get("rotation_deg", 0)))
    c, sn = math.cos(rad), math.sin(rad)
    rx = sx * c - sz * sn
    rz = sx * sn + sz * c
    rx = rx * float(t["axis_sign"]["x"]); rz = rz * float(t["axis_sign"]["z"])
    return rx + float(t["origin_m"]["x"]), rz + float(t["origin_m"]["z"])


def apply_transform_to_velocity(t: dict, vx, vz):
    vx = np.asarray(vx, float); vz = np.asarray(vz, float)
    ax = vz if t["axis_map"]["px"] == "z" else vx
    az = vx if t["axis_map"]["py"] == "x" else vz
    s = float(t.get("scale", 1) or 1)
    rad = math.radians(float(t.get("rotation_deg", 0)))
    c, sn = math.cos(rad), math.sin(rad)
    rx = (ax * s * c - az * s * sn) * float(t["axis_sign"]["x"])
    rz = (ax * s * sn + az * s * c) * float(t["axis_sign"]["z"])
    return rx, rz


def raw_mqtt_to_venue(t: dict, x, y, z):
    fx, _h, fz = perception_to_floor(t["input_frame"], x, y, z)
    return apply_transform_to_point(t, fx, fz)


def parquet_to_venue(t: dict, px, pz):
    """parquet x = MQTT position.x, parquet z = MQTT position.y (relabel only). Apply the REP-103 flip here."""
    y_sign = -1.0 if t["input_frame"] == "ros_rep103" else 1.0
    return apply_transform_to_point(t, np.asarray(px, float), y_sign * np.asarray(pz, float))


def parquet_velocity_to_venue(t: dict, vx, vz):
    y_sign = -1.0 if t["input_frame"] == "ros_rep103" else 1.0
    return apply_transform_to_velocity(t, vx, y_sign * np.asarray(vz, float))
