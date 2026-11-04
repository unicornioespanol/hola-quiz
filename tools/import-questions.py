"""Regenerate browser questions and SQL seed from the original workbook (stdlib only)."""
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
with zipfile.ZipFile(next(ROOT.glob("*.xlsx"))) as archive:
    shared = []
    if "xl/sharedStrings.xml" in archive.namelist():
        shared = ["".join(e.itertext()) for e in ET.fromstring(archive.read("xl/sharedStrings.xml")).findall("s:si", NS)]
    questions = []
    for row in ET.fromstring(archive.read("xl/worksheets/sheet1.xml")).findall(".//s:row", NS):
        if int(row.get("r")) < 9:
            continue
        values = {}
        for cell in row:
            value_node = cell.find("s:v", NS)
            inline = cell.find("s:is", NS)
            value = value_node.text if value_node is not None else "".join(inline.itertext()) if inline is not None else ""
            if cell.get("t") == "s":
                value = shared[int(value)]
            values["".join(filter(str.isalpha, cell.get("r"))) ] = value
        if values.get("A"):
            questions.append({"id": len(questions), "text": values["A"], "options": [values[c] for c in "BCDE"], "seconds": int(values["F"]), "correct": int(values["G"]) - 1})
assert len(questions) == 10
for question in questions:
    assert len(question["options"]) == 4 and 0 <= question["correct"] <= 3
serialized = json.dumps(questions, ensure_ascii=False, indent=2)
(ROOT / "js/questions.js").write_text("// Generated from the supplied Excel workbook.\nexport const questions = " + serialized + ";\n", encoding="utf-8")
(ROOT / "supabase/questions.json").write_text(serialized + "\n", encoding="utf-8")
seed = "-- Generated from the supplied Excel workbook. Run after schema.sql.\n"
seed += "insert into quiz_private.questions (id,text,options,seconds,correct)\nselect id,text,options,seconds,correct from jsonb_to_recordset($questions$" + serialized + "$questions$::jsonb)\nas q(id integer,text text,options jsonb,seconds integer,correct integer)\non conflict(id) do update set text=excluded.text,options=excluded.options,seconds=excluded.seconds,correct=excluded.correct;\n"
(ROOT / "supabase/seed.sql").write_text(seed, encoding="utf-8")
print(f"Imported {len(questions)} questions.")
