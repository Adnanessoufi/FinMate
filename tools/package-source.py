"""Create the source ZIP."""
from pathlib import Path
import json
import zipfile
import hashlib

root = Path(__file__).resolve().parent.parent
root_files = ['.gitattributes', '.gitignore', '.env.example', 'README.md', 'package.json', 'package-lock.json', 'THIRD_PARTY_NOTICES.md', 'index.html', 'app.js', 'styles.css', 'finance.js', 'server.mjs', 'favicon.svg', 'sample-statement.csv']
folders = ['backend', 'tests', 'tools', 'samples', 'docs']
allowed_suffixes = {'.js', '.mjs', '.py', '.md', '.json', '.txt', '.csv', '.pdf', '.svg'}
excluded = {'tools/serve-review.mjs', 'docs/demo-video.md', 'docs/agent-benchmark-before-grounding.json', 'docs/live-model-provider-failure.json', 'docs/benchmark-human-review.md'}
files = [root / name for name in root_files]
for folder in folders:
    files.extend(path for path in (root / folder).rglob('*') if path.is_file() and path.suffix in allowed_suffixes and '__pycache__' not in path.parts and path.relative_to(root).as_posix() not in excluded)
files.append(root / 'screenshots/home.jpg')
files = sorted(set(files))
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
