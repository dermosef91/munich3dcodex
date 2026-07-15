#!/usr/bin/env python3
"""Self-test for the standard-library Bavarian LoD2 normalizer."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
CONVERTER = ROOT / "scripts" / "convert_bavaria_lod2.py"
FIXTURE = ROOT / "scripts" / "fixtures" / "lod2-synthetic.gml"


class ConverterTest(unittest.TestCase):
    def test_help_is_available(self) -> None:
        completed = subprocess.run(
            [sys.executable, str(CONVERTER), "--help"],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("WEST,SOUTH,EAST,NORTH", completed.stdout)
        self.assertIn("vertical-origin", completed.stdout)

    def test_fixture_is_clipped_transformed_and_provenanced(self) -> None:
        with tempfile.TemporaryDirectory(prefix="munich3d-lod2-test-") as directory:
            output = Path(directory) / "normalized.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    str(CONVERTER),
                    str(FIXTURE),
                    "--output",
                    str(output),
                    "--bbox",
                    "11.5715,48.1505,11.5730,48.1520",
                    "--vertical-origin",
                    "500",
                    "--pretty",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(payload["schemaVersion"], "munich3d-lod2-normalized-v1")
        self.assertEqual(payload["stats"]["buildingObjectsRead"], 2)
        self.assertEqual(payload["stats"]["buildingsEmitted"], 1)
        self.assertEqual(payload["stats"]["outsideClip"], 1)
        self.assertEqual(payload["coordinateSystem"]["outputAxes"], {
            "x": "east",
            "y": "up",
            "z": "south",
        })

        building = payload["buildings"][0]
        self.assertEqual(building["id"], "synthetic-inside")
        self.assertEqual(building["height"], 12.0)
        self.assertEqual(building["bbox"]["min"][1], 20.0)
        self.assertEqual(building["bbox"]["max"][1], 32.0)
        self.assertLess(abs(building["centroid"][0]), 30.0)
        self.assertLess(abs(building["centroid"][2]), 30.0)
        self.assertEqual(building["metadata"]["genericAttributes"]["fixtureRole"], "inside-clip")

        surface_types = {surface["type"] for surface in building["surfaces"]}
        self.assertEqual(surface_types, {"ground", "roof", "wall"})
        self.assertEqual(len(building["provenance"]["sourceSha256"]), 64)
        self.assertEqual(building["provenance"]["gmlId"], "synthetic-inside")

        for surface in building["surfaces"]:
            for polygon in surface["polygons"]:
                # Normalization removes the redundant closing vertex.
                self.assertNotEqual(polygon["exterior"][0], polygon["exterior"][-1])
                self.assertGreaterEqual(len(polygon["exterior"]), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
