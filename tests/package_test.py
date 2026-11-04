import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("package_site", Path(__file__).resolve().parents[1] / "tools/package-site.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class PublishConfigTest(unittest.TestCase):
    def test_js_and_json_property_names_are_supported(self):
        configs = [
            "window.QUIZ_CONFIG={supabaseUrl:'https://demo.supabase.co',supabasePublishableKey:'sb_publishable_example'};",
            "window.QUIZ_CONFIG=" + json.dumps({"supabaseUrl": "https://demo.supabase.co", "supabasePublishableKey": "sb_publishable_example"}) + ";",
        ]
        for content in configs:
            with self.subTest(content=content):
                packager.validate_config(content)

    def test_empty_or_secret_configuration_cannot_be_published(self):
        for key in ("", "sb_secret_example"):
            with self.subTest(key=key), self.assertRaises(ValueError):
                packager.validate_config(json.dumps({"supabaseUrl": "https://demo.supabase.co", "supabasePublishableKey": key}))


if __name__ == "__main__":
    unittest.main()
