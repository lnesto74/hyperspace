"""Synthetic twin + staff-removal tests for STEP A / H."""
import sys
from pathlib import Path
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
from department_areas import (
    CELL, CORSIE, INGRESSO, SCAFFALI, R_AREA, R_BANCO, V_SLOW,
    apply_staff_removal, build_raster, choice_index, classify_points, geometry_hash,
)


def _roi(name, group, poly, department=None):
    return {"id": name, "name": name, "group": group, "department": department, "poly": poly, "vertices": list(poly.exterior.coords)}


def _obj(oid, typ, poly):
    return {"id": oid, "type": typ, "name": oid, "poly": poly}


def synthetic_twin():
    """Two shelves (Frutta, Carne), one banco, one entrance, one checkout queue."""
    fruit_strip = box(10, 10, 14, 11.5)
    meat_strip = box(30, 10, 34, 11.5)
    fruit_shelf = box(10, 8.5, 14, 10.2)
    meat_shelf = box(30, 8.5, 34, 10.2)
    meat_banco = box(30, 8.2, 34, 8.8)
    entrance = box(2, 20, 6, 24)
    queue = box(50, 20, 56, 26)
    staff = {"dept": "Carne", "x0": 30, "x1": 34, "z0": 4.0, "z1": 8.0}
    rois = [
        _roi("Frutta eng", "SHELF_ENGAGEMENT", fruit_strip, "Frutta"),
        _roi("Carne eng", "SHELF_ENGAGEMENT", meat_strip, "Carne"),
        _roi("Entrance", "ENTRANCE", entrance),
        _roi("Checkout 1 queue", "CHECKOUT_QUEUE", queue),
    ]
    objs = [
        _obj("shelf-frutta", "shelf", fruit_shelf),
        _obj("shelf-carne", "shelf", meat_shelf),
        _obj("banco-carne", "banco", meat_banco),
    ]
    return rois, objs, [staff]


def test_raster_codes_and_m2():
    rois, objs, staff = synthetic_twin()
    ras = build_raster(rois, objs, staff, map_x=80, map_z=40)
    assert "Frutta" in ras["depts"] and "Carne" in ras["depts"]
    code = ras["dept_code"]
    # cell in front of Frutta shelf (x=12, z=11.2) is inside 3 m and owned by Frutta strip
    i = int(12 / CELL)
    j = int(11.2 / CELL)
    assert ras["depts"][int(code[i, j])] == "Frutta"
    # 0.5 m in front of Carne fixture is banco
    i2 = int(32 / CELL)
    j2 = int(10.6 / CELL)
    assert ras["banco"][i2, j2]
    # entrance + 1 m is excluded
    ie = int(4 / CELL)
    je = int(22 / CELL)
    assert code[ie, je] == -2
    # staff strip behind Carne is excluded
    js = int(6 / CELL)
    assert code[i2, js] == -2
    areas = ras["areas_m2"]
    assert areas["Frutta"] > 5
    assert areas["Carne"] > 5
    # hash is stable
    assert geometry_hash(rois, objs, staff) == geometry_hash(rois, objs, staff)


def test_walking_is_area_only_standing_is_counter():
    rois, objs, staff = synthetic_twin()
    ras = build_raster(rois, objs, staff, map_x=80, map_z=40)
    # standing 0.5 m from Carne fixture, speed 0
    dept, banco = classify_points([32.0], [10.6], [0.0], ras)
    assert ras["depts"][int(dept[0])] == "Carne"
    assert bool(banco[0]) is True
    # walking past at 1.2 m/s in the same cell: area only
    dept2, banco2 = classify_points([32.0], [10.6], [1.2], ras)
    assert ras["depts"][int(dept2[0])] == "Carne"
    assert bool(banco2[0]) is False
    assert 1.2 > V_SLOW


def test_staff_removal_order():
    area_pm = {
        "Frutta": 100.0,
        SCAFFALI: 200.0,
        CORSIE: 80.0,
        INGRESSO: 40.0,
    }
    banco_pm = {"Frutta": 40.0, SCAFFALI: 80.0}
    staff_pm = 100.0  # more than corsie
    res, f_sc = apply_staff_removal(area_pm, banco_pm, staff_pm, entrances=10)
    assert res[CORSIE] == 0.0
    # remainder 20 taken from Scaffali: 200-20=180 → 18.0 min/customer
    assert res[SCAFFALI]["area"] == 18.0
    assert res[SCAFFALI]["al_banco"] == 7.2  # 80 * (180/200) / 10
    # fresh departments untouched
    assert res["Frutta"]["area"] == 10.0
    assert res["Frutta"]["al_banco"] == 4.0
    assert res[INGRESSO] == 4.0
    total = res["Frutta"]["area"] + res[SCAFFALI]["area"] + res[CORSIE] + res[INGRESSO]
    # Little: (100+200+80+40 - 100) / 10 = 32
    assert abs(total - res["TOTALE"]) < 0.02
    assert abs(res["TOTALE"] - 32.0) < 0.02


def test_choice_index_thresholds():
    assert choice_index(0.1, 1.0) == 0.1
    assert choice_index(0.32, 1.63) == 0.196
    assert choice_index(0.74, 1.54) == 0.481
    assert R_AREA == 3.0 and R_BANCO == 1.0


if __name__ == "__main__":
    test_raster_codes_and_m2()
    test_walking_is_area_only_standing_is_counter()
    test_staff_removal_order()
    test_choice_index_thresholds()
    print("all department_areas tests passed")
