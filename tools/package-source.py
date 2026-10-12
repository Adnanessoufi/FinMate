"""Create the source ZIP."""
from pathlib import Path
import json
import zipfile
import hashlib

root = Path(__file__).resolve().parent.parent
import subprocess

names = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
files = sorted(root / name for name in names if name and (root / name).is_file() and not name.startswith('pitch/'))
for path in files:
    if not path.is_file() or not path.resolve().is_relative_to(root):
        raise RuntimeError('Source manifest contains a missing or external file.')

secrets = []
environment = root / '.env'
if environment.exists():
    for line in environment.read_text(encoding='utf-8-sig').splitlines():
        name, separator, value = line.partition('=')
        if separator and name.strip() in {'OPENAI_API_KEY', 'FINMATE_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'FINMATE_STORAGE_KEY'}:
            value = value.strip().strip('"').strip("'")
            if len(value) >= 10:
                secrets.append(value.encode())
for path in files:
    content = path.read_bytes()
    if any(secret in content for secret in secrets):
        raise RuntimeError('A configured credential was found in a source file. Packaging stopped.')

output = root / 'FinMate-source.zip'
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in files:
        archive.write(path, 'FinMate/' + path.relative_to(root).as_posix())
with zipfile.ZipFile(output) as archive:
    names = archive.namelist()
    assert archive.testzip() is None
    assert 'FinMate/.env.example' in names
    assert not any(name == 'FinMate/.env' or name.startswith(('FinMate/data/', 'FinMate/node_modules/')) for name in names)
    assert 'FinMate/backend/guardian.mjs' in names
    assert 'FinMate/backend/family.mjs' in names
    assert 'FinMate/docs/sandbox-execution-evidence.json' in names
print(json.dumps({'archive': output.name, 'files': len(files), 'bytes': output.stat().st_size, 'credentialScanPassed': True, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}))
