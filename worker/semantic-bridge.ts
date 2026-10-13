import {DurableObject} from 'cloudflare:workers';
import type {SemanticJob,SemanticReply} from './semantic-protocol';
type AgentInfo={modelVersion:string;catalogVersion:string;device:string};

// Coordination atom = this single Mac inference agent. Requests are transient;
// a restart drops in-flight work and the Worker falls back to TF-IDF.
export class SemanticBridge extends DurableObject<Env> {
  private pending=new Map<string,{socket:WebSocket;finish:(result:unknown)=>void}>();
  async fetch(request:Request):Promise<Response>{
    if(request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    const [client,server]=Object.values(new WebSocketPair());
    const role=new URL(request.url).searchParams.get('role')==='llm'?'llm':'mac';
    for(const old of this.ctx.getWebSockets(role))old.close(1000,'agent replaced');
    this.ctx.acceptWebSocket(server,[role]);
    server.serializeAttachment({ready:false});
    return new Response(null,{status:101,webSocket:client});
  }
  private agentStatus(role:string){
    const socket=this.ctx.getWebSockets(role).find(s=>s.readyState===1);
    const attachment=socket?.deserializeAttachment();
    return {connected:!!socket,ready:!!socket&&attachment?.ready===true,
      ...(attachment?.ready ? {modelVersion:attachment.modelVersion,catalogVersion:attachment.catalogVersion,device:attachment.device}: {})};
  }
  status(){return {...this.agentStatus('mac'),llm:this.agentStatus('llm')};}
  async rank(job:SemanticJob):Promise<SemanticReply|null>{
    const socket=this.ctx.getWebSockets('mac').find(s=>s.readyState===1&&s.deserializeAttachment()?.ready);
    if(!socket||socket.deserializeAttachment().catalogVersion!==job.catalogVersion||this.pending.size>=8)return null;
    return await this.request(socket,'rank',job,5000) as SemanticReply|null;
  }
  async conversation(job:unknown):Promise<unknown>{
    const socket=this.ctx.getWebSockets('llm').find(s=>s.readyState===1&&s.deserializeAttachment()?.ready);
    if(!socket||this.pending.size>=8)return null;
    return this.request(socket,'chat',job,20000);
  }
  private request(socket:WebSocket,type:string,job:unknown,timeout:number):Promise<unknown>{
    const id=crypto.randomUUID();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>finish(null),timeout);
      const finish=(result:unknown)=>{clearTimeout(timer);this.pending.delete(id);resolve(result);};
      this.pending.set(id,{socket,finish});
      try{socket.send(JSON.stringify({type,id,...(job as object)}));}catch{finish(null);}
    });
  }
  webSocketMessage(socket:WebSocket,message:string|ArrayBuffer){
    if(typeof message!=='string'||message.length>65536){socket.close(1009,'invalid message');return;}
    let body;try{body=JSON.parse(message);}catch{return;}
    if(body.type==='ready'){
      if(typeof body.modelVersion!=='string'||body.modelVersion.length>160||typeof body.catalogVersion!=='string'||!/^[a-f0-9]{64}$/.test(body.catalogVersion)||!['cpu','mps','mlx'].includes(body.device))return;
      const info:AgentInfo={modelVersion:body.modelVersion,catalogVersion:body.catalogVersion,device:body.device};
      socket.serializeAttachment({ready:true,...info});return;
    }
    if(typeof body.id!=='string')return;
    const pending=this.pending.get(body.id);if(!pending||pending.socket!==socket)return;
    if(body.type==='result')pending.finish(body.result);
    else if(body.type==='error')pending.finish(null);
  }
  webSocketClose(socket:WebSocket){for(const item of this.pending.values())if(item.socket===socket)item.finish(null);}
  webSocketError(socket:WebSocket){this.webSocketClose(socket);}
}
