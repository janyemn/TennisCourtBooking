"""Build a source-only archive using an explicit allowlist. Never include .local."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
files = []
for directory, extensions in [('src', {'.mjs'}), ('app', {'.mjs', '.html', '.js', '.css'}), ('config', {'.json'})]:
    files.extend(p for p in (root / directory).rglob('*') if p.is_file() and p.suffix in extensions)
for name in ['README.md', 'package.json', 'start-app.cmd', 'start-session-sync.cmd', 'start-session-sync-clash.cmd',
             'tools/start-app.ps1', 'tools/start-session-sync.ps1', 'tools/configure-session-sync.ps1',
             'tools/session_sync.py', 'docs/首次使用.md']:
    files.append(root / name)
out = root / 'dist' / 'tennis-local.zip'
out.parent.mkdir(exist_ok=True)
with ZipFile(out, 'w', ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, path.relative_to(root))
print(f'Created {out.name}: {len(files)} source files; no .local, HAR, account or certificate files.')
