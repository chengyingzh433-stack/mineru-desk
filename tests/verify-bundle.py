"""Verify the actual release ZIP, not just its staging folder."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

archive = Path(sys.argv[1])
with zipfile.ZipFile(archive) as z:
    names = z.namelist()
    assert len(names) == len(set(names)), 'Duplicate ZIP entries'
    roots = {name.split('/')[0] for name in names}
    assert len(roots) == 1
    root = roots.pop()
    manifest = json.loads(z.read(root + '/file-manifest.json'))
    expected = {root + '/' + item['path'] for item in manifest['files']}
    assert set(names) == expected | {root + '/file-manifest.json'}
    for item in manifest['files']:
        assert not item['path'].startswith(('data/', 'models/', 'cache/', 'output/'))
        assert '..' not in Path(item['path']).parts
        with z.open(root + '/' + item['path']) as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        assert actual == item['sha256'], item['path']
    with archive.open('rb') as stream:
        archive_hash = hashlib.file_digest(stream, 'sha256').hexdigest()
    assert archive.with_suffix('.zip.sha256').read_text(encoding='utf-8').split()[0] == archive_hash
    print(json.dumps({'status':'passed','staticFiles':len(manifest['files']),'duplicateEntries':0,'privateWorkingDirectories':0,'sha256':archive_hash}))
