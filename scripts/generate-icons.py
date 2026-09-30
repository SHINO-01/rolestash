"""Renders the toolbar/store icons from brand/rolestash-mark.svg (run once; output is committed).

Usage: python3 scripts/generate-icons.py   (requires `pip install playwright`)
"""
import asyncio
import os
from pathlib import Path
from urllib.parse import quote
from playwright.async_api import async_playwright

SVG = (Path(__file__).resolve().parent.parent / 'brand' / 'rolestash-mark.svg').read_text().strip()

async def main():
    out = Path(__file__).resolve().parent.parent / 'public' / 'icon'
    out.mkdir(parents=True, exist_ok=True)
    (out / 'icon.svg').write_text(SVG)
    async with async_playwright() as p:
        path = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
        browser = await p.chromium.launch(**({'executable_path': path} if path else {}))
        page = await browser.new_page()
        for size in (16, 32, 48, 96, 128):
            await page.set_viewport_size({'width': size, 'height': size})
            await page.set_content(f"<html><body style='margin:0;background:transparent'><img src=\"data:image/svg+xml;utf8,{quote(SVG)}\" width='{size}' height='{size}'></body></html>")
            await page.screenshot(path=str(out / f'{size}.png'), omit_background=True)
        await browser.close()

asyncio.run(main())
