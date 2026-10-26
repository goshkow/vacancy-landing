import unittest
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]


class SiteParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


class SiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.page = SiteParser()
        cls.page.feed((ROOT / 'index.html').read_text())
        cls.ids = [attrs['id'] for _, attrs in cls.page.tags if 'id' in attrs]

    def test_unique_ids(self):
        self.assertEqual(len(self.ids), len(set(self.ids)))

    def test_local_links_and_assets_exist(self):
        for tag, attrs in self.page.tags:
            for name in ('href', 'src'):
                value = attrs.get(name, '')
                if not value:
                    continue
                url = urlsplit(value)
                if url.scheme or url.netloc:
                    continue
                if url.fragment and not url.path:
                    self.assertIn(url.fragment, self.ids, value)
                if url.path:
                    target = (ROOT / unquote(url.path)).resolve()
                    self.assertTrue(target.is_relative_to(ROOT), value)
                    self.assertTrue(target.is_file(), value)

    def test_no_screenshot_or_remote_runtime(self):
        for tag, attrs in self.page.tags:
            if tag in ('img', 'script'):
                src = attrs.get('src', '')
                self.assertFalse(urlsplit(src).scheme, src)
                self.assertNotIn('desktop.webp', src)

    def test_external_tabs_are_isolated(self):
        for tag, attrs in self.page.tags:
            if tag == 'a' and attrs.get('target') == '_blank':
                self.assertIn('noopener', attrs.get('rel', '').split())

    def test_buttons_have_explicit_type(self):
        for tag, attrs in self.page.tags:
            if tag == 'button':
                self.assertEqual(attrs.get('type'), 'button')

    def test_aria_references_resolve(self):
        for _, attrs in self.page.tags:
            for name in ('aria-controls', 'aria-labelledby'):
                for id_ in attrs.get(name, '').split():
                    self.assertIn(id_, self.ids)

    def test_pdf_is_local_valid_document(self):
        self.assertTrue((ROOT / 'assets/Ivan-Agoshkov-CV.pdf').read_bytes().startswith(b'%PDF-'))


if __name__ == '__main__':
    unittest.main()
