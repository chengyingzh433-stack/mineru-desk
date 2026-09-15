"""Build a clean, relocatable CPU bundle from a pinned local dependency set.
No settings, tokens, histories, caches or models are copied.
"""
import argparse
import hashlib
import importlib.metadata as metadata
import json
import shutil
import urllib.request
import zipfile
from pathlib import Path
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('--app', type=Path, required=True)
p.add_argument('--site-packages', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--fixtures', type=Path, required=True)
a = p.parse_args()
root = a.output.resolve()
if root.exists():
    raise SystemExit('Output already exists; use a new, empty staging path.')
sources = Path(__file__).resolve().parent
root.mkdir(parents=True)
shutil.copytree(a.app, root / 'app')
runtime = root / 'runtime'
runtime.mkdir()
url = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
archive = root.parent / 'python-3.12.10-embed-amd64.zip'
if not archive.exists():
    print('Downloading official CPython embedded distribution', flush=True)
    urllib.request.urlretrieve(url, archive)
raw = archive.read_bytes()
if hashlib.md5(raw).hexdigest() != 'fe8ef205f2e9c3ba44d0cf9954e1abd3':
    raise SystemExit('Python archive does not match official published checksum')
with zipfile.ZipFile(archive) as z:
    z.extractall(runtime)
print('Copying runtime dependencies', flush=True)
for item in a.site_packages.rglob('*'):
    if item.is_symlink():
        raise SystemExit('Unexpected dependency symlink: ' + str(item))
for f in a.site_packages.glob('*.pth'):
    if f.name != 'distutils-precedence.pth':
        raise SystemExit('Review unexpected path injection file before shipping: ' + f.name)
shutil.copytree(a.site_packages, runtime / 'Lib' / 'site-packages', ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo', 'direct_url.json'))
fasttext_file = runtime / 'Lib/site-packages/fasttext/FastText.py'
fasttext_source = fasttext_file.read_text(encoding='utf-8')
original_loader = 'def load_model(path):\n    """Load a model given a filepath and return a model object."""\n    return _FastText(model_path=path)'
if 'MinerU Desk compatibility patch' not in fasttext_source:
    if original_loader not in fasttext_source:
        raise SystemExit('FastText loader changed; review compatibility patch before building')
    fasttext_file.write_text(fasttext_source.replace(original_loader, (sources / 'fasttext-load-model.py.txt').read_text(encoding='utf-8').rstrip()), encoding='utf-8')
(runtime / 'python312._pth').write_text('python312.zip\n.\nLib/site-packages\n', encoding='utf-8')
entries = {
    'mineru-cli': ('mineru.cli.client', 'main'),
    'mineru-api': ('mineru.cli.fast_api', 'main'),
    'mineru-gradio': ('mineru.cli.gradio_app', 'main'),
    'mineru-models-download': ('mineru.cli.models_download', 'download_models'),
    'mineru-openai-server': ('mineru.cli.vlm_server', 'openai_server'),
    'mineru-router': ('mineru.cli.router', 'main'),
}
for name, (module, function) in entries.items():
    (runtime / (name + '.py')).write_text(f'from {module} import {function}\nif __name__ == "__main__":\n    {function}()\n', encoding='utf-8')
for name in ['Codex.ps1', '开始使用.md', '给Codex的接入说明.md', '第三方组件说明.md']:
    shutil.copy2(sources / name, root / name)
shutil.copy2(sources / 'Launch.vbs', root / '打开 MinerU Desk.vbs')
shutil.copytree(a.fixtures, root / 'examples')
packaging_source = root / 'packaging-source'
packaging_source.mkdir()
# Explicit sources only: this directory can also contain local build tools,
# abandoned model payloads and private build notes that must never ship.
for name in [
    'build_bundle.py', 'finalize_bundle.py', 'create-manifest.mjs',
    'make_fixtures.py', 'fasttext-load-model.py.txt', 'Codex.ps1', 'Launch.vbs',
    'installer-config.json', 'installer-marker.json', 'installer.iss',
    'installer.nsh', '安装前说明.txt', '安装使用说明.md',
    '安装版Codex接入.md', '第三方组件说明.md', '构建安装包.md',
    '开始使用.md', '给Codex的接入说明.md',
]:
    shutil.copy2(sources / name, packaging_source / name)
inventory = []
for dist in metadata.distributions(path=[str(a.site_packages)]):
    inventory.append({'name': dist.metadata['Name'], 'version': dist.version, 'license': dist.metadata.get('License-Expression') or dist.metadata.get('License', '')[:2000]})
(root / 'dependency-inventory.json').write_text(json.dumps(sorted(inventory,key=lambda d:d['name'].lower()),ensure_ascii=False,indent=2),encoding='utf-8')
licenses = root / 'licenses'
licenses.mkdir()
shutil.copy2(runtime / 'LICENSE.txt', licenses / 'Python-LICENSE.txt')
shutil.copy2(a.site_packages / 'mineru-3.4.5.dist-info' / 'licenses' / 'LICENSE.md', licenses / 'MinerU-LICENSE.md')
app_version = json.loads((a.app / 'resources' / 'app' / 'package.json').read_text(encoding='utf-8'))['version']
marker = {'schema':1,'name':'MinerU Desk','version':app_version,'platform':'win32-x64','runtime':'CPython 3.12.10 / MinerU 3.4.5 / PyTorch 2.8.0+cpu','modelsIncluded':False,'builtAt':datetime.now(timezone.utc).isoformat(),'pythonSource':url,'pythonArchiveSHA256':hashlib.sha256(raw).hexdigest()}
(root / 'mineru-desk-bundle.json').write_text(json.dumps(marker,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'bundle':str(root),'packages':len(inventory),'status':'staged'},ensure_ascii=False),flush=True)
