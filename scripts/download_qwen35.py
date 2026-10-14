"""Fetch the pinned MLX Qwen3.5-9B 4-bit snapshot and verify upstream hashes."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
REPO='mlx-community/Qwen3.5-9B-4bit'
REVISION='8b2b98c00a6b4d291155e4890773ca8f769aee53'
EXPECTED={
    'model-00001-of-00002.safetensors':'a68b87558c6ef43f74c2bd63ce7e9092ceddc3101f3def0030774bae5f42aadd',
    'model-00002-of-00002.safetensors':'b0a770bf8469c7f3f18756a0e0283f1c1174344a83e059a4e483f6af4907352d',
    'tokenizer.json':'87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4',
}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check',action='store_true',help='Verify local files without downloading or rewriting')
    args=parser.parse_args()
    out=ROOT/'training_artifacts/qwen3.5-9b-4bit'
    if not args.check:
        from huggingface_hub import snapshot_download
        snapshot_download(REPO,revision=REVISION,local_dir=out,
            allow_patterns=['*.safetensors','*.json','chat_template.jinja','README.md'],max_workers=4)
    for name,expected in EXPECTED.items():
        digest=hashlib.sha256()
        with (out/name).open('rb') as f:
            for chunk in iter(lambda:f.read(8*1024*1024),b''):digest.update(chunk)
        if digest.hexdigest()!=expected:raise RuntimeError('Checksum mismatch: '+name)
    source={'model':REPO,'revision':REVISION,'base':'Qwen/Qwen3.5-9B','quantization':'4bit',
        'version_prefix':'qwen3.5-9b-4bit','weight_sha256':EXPECTED}
    if args.check:
        if json.loads((out/'source.json').read_text())!=source:raise RuntimeError('Source manifest mismatch')
    else:(out/'source.json').write_text(json.dumps(source,indent=2)+'\n')
    print('QWEN35_VERIFIED='+REVISION)

if __name__=='__main__':main()
