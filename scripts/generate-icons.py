"""Renders the toolbar/store icons from the logo SVG (run once; output is committed).

Usage: python3 scripts/generate-icons.py   (requires `pip install playwright`)
"""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

SVG = """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>
<rect width='32' height='32' rx='8' fill='#4f46e5'/>
<rect x='7' y='8' width='5' height='16' rx='1.6' fill='white' opacity='0.95'/>
<rect x='13.5' y='8' width='5' height='11' rx='1.6' fill='white' opacity='0.75'/>
<rect x='20' y='8' width='5' height='7' rx='1.6' fill='white' opacity='0.55'/>
</svg>"""

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
            await page.set_content(f"<html><body style='margin:0;background:transparent'><img src=\"data:image/svg+xml;utf8,{SVG}\" width='{size}' height='{size}'></body></html>")
            await page.screenshot(path=str(out / f'{size}.png'), omit_background=True)
        await browser.close()

asyncio.run(main())
