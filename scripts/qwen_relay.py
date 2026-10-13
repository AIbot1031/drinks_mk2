"""Loopback-only byte relay to one fixed Worker; TLS stays end-to-end in Qwen."""
import asyncio

try:
    from .inference_audit import audit
except ImportError:
    from inference_audit import audit

HOST='drinks-mk2.rtx941031.workers.dev'
PORT=52791
active=0

def requested_host(record:bytes):
    """Read bounded, unencrypted TLS ClientHello SNI; never decrypt application data."""
    try:
        if len(record)<9 or record[0]!=22 or len(record)-5!=int.from_bytes(record[3:5],'big'):return None
        hello=record[5:]
        if hello[0]!=1 or int.from_bytes(hello[1:4],'big')!=len(hello)-4:return None
        body=hello[4:];pos=34
        pos+=1+body[pos]
        size=int.from_bytes(body[pos:pos+2],'big');pos+=2+size
        pos+=1+body[pos]
        size=int.from_bytes(body[pos:pos+2],'big');pos+=2;end=pos+size
        if end!=len(body):return None
        names=[]
        while pos<end:
            kind=int.from_bytes(body[pos:pos+2],'big');size=int.from_bytes(body[pos+2:pos+4],'big');pos+=4
            data=body[pos:pos+size];pos+=size
            if len(data)!=size:return None
            if kind==0:
                if int.from_bytes(data[:2],'big')!=len(data)-2:return None
                at=2
                while at<len(data):
                    name_type=data[at];n=int.from_bytes(data[at+1:at+3],'big');at+=3
                    value=data[at:at+n];at+=n
                    if len(value)!=n or name_type!=0:return None
                    names.append(value.decode('ascii').lower())
        return names[0] if pos==end and len(names)==1 else None
    except (IndexError,UnicodeError):return None

async def handle(reader,writer):
    global active
    if active>=8:writer.close();return
    active+=1;remote=None;tasks=[]
    try:
        header=await asyncio.wait_for(reader.readexactly(5),5)
        size=int.from_bytes(header[3:5],'big')
        if header[0]!=22 or size>16384:raise ValueError('TLS required')
        first=header+await asyncio.wait_for(reader.readexactly(size),5)
        if requested_host(first)!=HOST:raise ValueError('Unapproved TLS destination')
        upstream,remote=await asyncio.wait_for(asyncio.open_connection(HOST,443),10)
        audit('relay','relay_started',activeConnections=active)
        remote.write(first);await remote.drain()
        async def pipe(source,target):
            while True:
                block=await asyncio.wait_for(source.read(65536),120)
                if not block:return
                target.write(block);await target.drain()
        tasks=[asyncio.create_task(pipe(reader,remote)),asyncio.create_task(pipe(upstream,writer))]
        await asyncio.wait(tasks,return_when=asyncio.FIRST_COMPLETED)
    except Exception as exc:print('RELAY_ERROR='+type(exc).__name__,flush=True)
    finally:
        for task in tasks:task.cancel()
        if tasks:await asyncio.gather(*tasks,return_exceptions=True)
        writer.close()
        if remote:remote.close()
        active-=1
        audit('relay','relay_closed',activeConnections=active)
async def main():
    server=await asyncio.start_server(handle,'127.0.0.1',PORT)
    print('FIXED_WORKER_RELAY_READY',flush=True)
    async with server:await server.serve_forever()
if __name__=='__main__':asyncio.run(main())
