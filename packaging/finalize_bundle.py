"""Create checksummed, clean ZIP. Mutable state is never included."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root = Path(sys.argv[1]).resolve()
archive = root.parent / (root.name + '.zip')
if archive.exists():
    raise SystemExit('Archive exists; refuse to overwrite a released ZIP.')
allowed = ['app','runtime','examples','licenses','packaging-source']
files = [f for name in allowed for f in (root / name).rglob('*') if f.is_file() and '__pycache__' not in f.parts and f.suffix not in ['.pyc','.pyo']]
files += [f for f in root.iterdir() if f.is_file() and f.name != 'file-manifest.json' and f.suffix in ['.md','.json','.ps1','.vbs']]
if any(f.is_symlink() for f in files):
    raise SystemExit('Unexpected symlink')
for f in files:
    if f.name in ['state.json','connection.json','cloud-token.dat','owned-models.json','mineru.json'] or f.suffix in ['.incomplete','.partial']:
        raise SystemExit('Private or incomplete resource in bundle: ' + str(f))
def digest(f):
    with f.open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()
manifest = {'schema':1,'files':[{'path':f.relative_to(root).as_posix(),'bytes':f.stat().st_size,'sha256':digest(f)} for f in sorted(files)]}
mf = root / 'file-manifest.json'
mf.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('Verified clean allowlist; compressing ' + str(len(files)) + ' files',flush=True)
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5,allowZip64=True) as z:
    for f in files + [mf]:
        z.write(f,arcname=root.name + '/' + f.relative_to(root).as_posix())
checksum=digest(archive)
archive.with_suffix('.zip.sha256').write_text(checksum + '  ' + archive.name + '\n',encoding='utf-8')
print(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'uncompressedBytes':sum(f.stat().st_size for f in files),'sha256':checksum},ensure_ascii=False),flush=True)
