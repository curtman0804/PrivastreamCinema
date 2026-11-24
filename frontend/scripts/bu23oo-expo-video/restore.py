import pathlib, hashlib, json
root=pathlib.Path(__file__).resolve().parent
frontend=root.parent.parent
manifest=json.loads((root/'manifest.json').read_text())
version=json.loads((frontend/'node_modules/expo-video/package.json').read_text())['version']
if version!=manifest['expo_video_version']: raise SystemExit('EXPO_VIDEO_VERSION_MISMATCH: '+version)
checks=[]
for relative,expected in manifest['files'].items():
    target=frontend/relative; data=(root/pathlib.Path(relative).name).read_bytes()
    if not target.is_file() or hashlib.sha256(data).hexdigest()!=expected: raise SystemExit('NATIVE_RESTORE_INPUT_MISMATCH: '+relative)
    checks.append((target,data,expected))
for target,data,expected in checks:
    target.write_bytes(data)
    if hashlib.sha256(target.read_bytes()).hexdigest()!=expected: raise SystemExit('NATIVE_RESTORE_HASH_MISMATCH: '+str(target))
print('BU23OO_NATIVE_RESTORE=PASS')
