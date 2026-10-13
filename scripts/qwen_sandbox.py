"""Build a local-only macOS sandbox for Qwen; generated profile contains no key."""
import json
from pathlib import Path

HOST='drinks-mk2.rtx941031.workers.dev'

def build_profile(runtime:Path)->Path:
    runtime=runtime.resolve()
    executable=(runtime/'.venv-llm/bin/python').resolve()
    python_base=executable.parent.parent
    quote=json.dumps
    allowed_read=[str(runtime),str(python_base)]
    read=' '.join(f'(subpath {quote(p)})' for p in allowed_read)
    outbound='(remote tcp \"localhost:52791\")'
    profile=f'''(version 1)
(allow default)
(deny file-read-data (require-all (subpath "/Users") (require-not (require-any {read}))))
(deny file-write* (require-not (require-any (subpath {quote(str(runtime/"logs"))}) (subpath {quote(str(runtime/"cache"))}) (subpath {quote(str(runtime/"tmp"))}) (subpath "/dev"))))
(deny file-write* (subpath {quote(str(runtime/'training_artifacts'))}) (literal {quote(str(runtime/'.llm-key'))}))
(deny process-fork)
(deny process-exec (require-not (literal {quote(str(executable))})))
(deny network-inbound)
(deny network-outbound (require-not (require-any {outbound})))
'''
    path=runtime/'qwen.sb';path.write_text(profile);path.chmod(0o600)
    relay=profile.replace('(deny network-inbound)','(deny network-inbound (require-not (local tcp \"localhost:52791\")))').replace(outbound,'(remote tcp \"*:443\") (literal \"/private/var/run/mDNSResponder\")')
    rp=runtime/'qwen-relay.sb';rp.write_text(relay);rp.chmod(0o600)
    for name in ['cache','tmp']:(runtime/name).mkdir(exist_ok=True,mode=0o700)
    return path

if __name__=='__main__':
    runtime=Path.home()/'Library/Application Support/DrinksMk2LLM'
    print(build_profile(runtime))
