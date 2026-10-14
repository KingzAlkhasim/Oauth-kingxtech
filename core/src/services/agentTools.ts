import { executeTerminalCommand } from './commandExecutor';
import { verifyProject } from './projectRuntime';
import {
  listProjectFiles,
  listProjectFilesWithContent,
  readProjectFile,
  writeProjectFile,
  createProjectFolder,
  deleteProjectFile,
} from './projectFs';
import {
  listSharedProjectFiles,
  readSharedProjectFile,
  writeSharedProjectFile,
  createSharedProjectFolder,
  deleteSharedProjectFile,
  sharedFileMetadata,
} from './sharedProjectFs';
import { getProjectRole } from './projectPermissions';
import { snapshotBeforeChange } from './versioning';
import { BINARY_PREFIX, extensionOf } from './binaryFiles';
import { Sentry } from '../lib/sentry';

export interface JSONSchemaProp { type: 'string' | 'array' | 'object'; description?: string; items?: JSONSchemaProp; }
export interface ToolDef { name: string; description: string; parameters: { type: 'object'; properties: Record<string, JSONSchemaProp>; required?: string[]; }; }
export interface ProjectContext { userId: string; projectId?: string; turnId?: string; readOnly?: boolean; publicApi?: boolean; }
export interface AgentTurn { role: 'user' | 'model'; text: string; }
export interface ToolStep { tool: string; args: Record<string, unknown>; status: 'ok' | 'error'; summary: string; }
export interface AgentUsage { inputTokens:number; outputTokens:number; cachedInputTokens:number; cacheCreationInputTokens?:number; }
export interface AgentOpts { modelId:string; history:AgentTurn[]; prompt:string; tools:ToolDef[]; ctx:ProjectContext; onStep?:(step:ToolStep)=>void; onUsage?:(usage:AgentUsage)=>boolean|void; chatOnly?:boolean; }
export interface AgentResult extends AgentUsage { text:string; steps:ToolStep[]; }

const FILE_TOOLS = ['listProjectFiles','readProjectFile','writeProjectFile','createProjectFolder','deleteProjectFile'];
const MUTATING_TOOLS = ['writeProjectFile','createProjectFolder','deleteProjectFile'];
export const AGENT_MAX_TOOL_STEPS = 15;
export const AGENT_MAX_DURATION_MS = 240_000;
const TOOL_RESULT_MAX_CHARS = 60_000;
const TOOL_RESULT_TRUNCATION_MARKER = '[TRUNCATED: file continues, do not overwrite the whole file]';

export function serializeToolResult(result: unknown): string { const serialized = typeof result === 'string' ? result : JSON.stringify(result); if (serialized.length <= TOOL_RESULT_MAX_CHARS) return serialized; const keep=Math.max(0,TOOL_RESULT_MAX_CHARS-TOOL_RESULT_TRUNCATION_MARKER.length-1); return serialized.slice(0,keep)+'\n'+TOOL_RESULT_TRUNCATION_MARKER; }
export function isConnectionReset(error: unknown): boolean { const e=error as {code?:unknown;cause?:{code?:unknown}}|null; return e?.code==='ECONNRESET'||e?.cause?.code==='ECONNRESET'; }
export function isAgentTimeout(error: unknown): boolean { return (error as {code?:unknown}|null)?.code==='AGENT_TIMEOUT'; }
export async function runProviderCall<T>(operation:()=>Promise<T>,deadlineAt:number):Promise<T>{let attempt=0;while(true){const remainingMs=deadlineAt-Date.now();if(remainingMs<=0)throw Object.assign(new Error('Agent execution time limit reached.'),{code:'AGENT_TIMEOUT'});let timer:NodeJS.Timeout|undefined;try{return await Promise.race([operation(),new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Agent execution time limit reached.'),{code:'AGENT_TIMEOUT'})),remainingMs);})]);}catch(error){if(attempt===0&&isConnectionReset(error)){attempt+=1;continue;}throw error;}finally{if(timer)clearTimeout(timer);}}}
export function buildAgentTimeoutSummary(steps:ToolStep[]):string{return synthesizeFallbackText(steps)+'\n\nI stopped the agent after 240 seconds to avoid the platform timeout.';}

export const TOOL_DEFS: ToolDef[] = [
{name:'verifyProject',description:'Verify the current project in the isolated sandbox. If node_modules is missing, install dependencies; then run tsc --noEmit and a Vite production build into a temporary directory. Returns trimmed compiler/build errors. Does not expose the general terminal.',parameters:{type:'object',properties:{}}},
{name:'executeTerminalCommand',description:"Run an allowlisted, read-only diagnostic command (git status/log/diff, npm test/run/ls, node --version, ls, pwd). Cannot install packages, build, or modify anything — use the file tools for that.",parameters:{type:'object',properties:{command:{type:'string',description:"The base command name, e.g. 'git', 'npm', 'ls'."},args:{type:'array',items:{type:'string'},description:"Arguments to the command, e.g. ['status'] for 'git status'."}},required:['command']}},
{name:'listProjectFiles',description:'List project paths and folders. Binary assets are listed as path, type, and byte size only; never expose their base64 payload.',parameters:{type:'object',properties:{}}},
{name:'readProjectFile',description:'Read a text file by project-relative path. Binary assets return only path, type, and byte size; reference their paths in code and do not try to edit binary data.',parameters:{type:'object',properties:{path:{type:'string',description:"File path relative to the project root, e.g. 'index.html'."}},required:['path']}},
{name:'writeProjectFile',description:'Create or overwrite a text file. Do not create, paste, or overwrite binary payloads; ask the user to upload binary assets through the workspace.',parameters:{type:'object',properties:{path:{type:'string',description:'File path relative to the project root.'},content:{type:'string',description:'The complete new contents of the file.'}},required:['path','content']}},
{name:'createProjectFolder',description:'Create a folder at the given path (no-op if it already exists).',parameters:{type:'object',properties:{path:{type:'string',description:'Folder path relative to the project root.'}},required:['path']}},
{name:'deleteProjectFile',description:"Delete a file, or a folder and everything inside it, at the given path. This can be undone via the version history, but only do it when the user's request clearly calls for it.",parameters:{type:'object',properties:{path:{type:'string',description:'File or folder path relative to the project root.'}},required:['path']}},
];

export function toolsForContext(ctx:ProjectContext):ToolDef[]{if(!ctx.projectId)return TOOL_DEFS.filter(t=>t.name==='executeTerminalCommand');if(ctx.readOnly)return TOOL_DEFS.filter(t=>!MUTATING_TOOLS.includes(t.name));return TOOL_DEFS;}

export function buildSystemInstruction(readOnly=false):string{const mode=readOnly?'Plan':'Build';return `CURRENT MODE: ${mode}\n\nYou are K-XpertAI, the official autonomous developer assistant for the KingxTech platform.\nYour core model is KX-NeuroCore.\nYour goal is to assist with web development, project management, and infrastructure tasks.\nAlways identify yourself as K-XpertAI when asked.\n\nYou can read, create, edit, and delete files inside the user's current project using your file tools — these operate on that project's own workspace only, never on any other user's data or the underlying server. Every change you make is versioned and can be undone by the user, and the user reviews a summary of everything you changed after each turn — so make deliberate, well-explained changes rather than speculative ones.\n\nIMPORTANT: after using any tools, you MUST always end your turn with a short natural-language message to the user explaining what you did and why, in plain language. Never end a turn with only tool calls and no explanation.\n\nWhen creating or editing HTML, always include real, deliberate CSS styling by default. Bare unstyled HTML is not an acceptable default.\n\nYou also have a small set of read-only diagnostic commands (git status/log/diff, npm test/run/ls, node --version, ls, pwd) — you cannot install packages, run builds, or execute arbitrary shell commands. If a request needs that, say so plainly rather than guessing or pretending you did it.\n\nProject-specific environment variables from Site Settings are injected into the isolated project sandbox for dependency installation, Vite builds, and dev/runtime processes. Server-side code can read private values with process.env.MY_SECRET. For Vite client code, only variables prefixed with VITE_ are exposed through import.meta.env; never put a real secret in a VITE_ variable.\nAgent workflow rules:\n- Read each file at most once per turn unless you need to verify a specific change.\n- Do not run git, ls, or pwd unless the user explicitly asks for those diagnostics.\n- For implementation requests, start editing within your first 3 tool steps.\n- Batch independent tool calls when possible.\n- If you introduce a new external import, add the corresponding dependency to package.json.\n- Never rewrite an entire file from a partial/truncated read.`;}

export function synthesizeFallbackText(steps:ToolStep[]):string{if(steps.length===0)return'No response generated.';const summary=steps.filter(s=>s.status==='ok').map(s=>`- ${s.summary}`).join('\n');const errors=steps.filter(s=>s.status==='error');let text=summary?`Done. Here's what I did:\n${summary}`:"I ran some tools but didn't produce a final summary — here's what happened:";if(errors.length>0)text+=`\n\nSome steps had issues:\n${errors.map(s=>`- ${s.summary}`).join('\n')}`;return text;}

export async function runTool(name:string,args:Record<string,unknown>,ctx:ProjectContext):Promise<{result:unknown;step:ToolStep}>{return Sentry.startSpan({name:`agent.tool.${name}`,op:'ai.tool',attributes:{'tool.name':name}},()=>runToolInner(name,args,ctx));}

async function runToolInner(name:string,args:Record<string,unknown>,ctx:ProjectContext):Promise<{result:unknown;step:ToolStep}>{
  if(FILE_TOOLS.includes(name)&&!ctx.projectId){const result={ok:false,error:'No project is open — file tools are unavailable outside a project workspace.'};return{result,step:{tool:name,args,status:'error',summary:'No project open.'}};}
  if(ctx.readOnly&&MUTATING_TOOLS.includes(name)){const result={ok:false,error:'Planning mode is read-only — this tool cannot modify project files.'};return{result,step:{tool:name,args,status:'error',summary:'Blocked mutation in planning mode.'}};}
  if(ctx.projectId){const role=await getProjectRole(ctx.userId,ctx.projectId);if(!role){const result={ok:false,error:'You are no longer a member of this project.'};return{result,step:{tool:name,args,status:'error',summary:'Blocked: project membership is required.'}};}if(MUTATING_TOOLS.includes(name)&&role==='viewer'){const result={ok:false,error:'View-only members cannot modify project files.'};return{result,step:{tool:name,args,status:'error',summary:'Blocked write: viewer role.'}};}}
  try{
    let result:unknown;let summary:string;
    if(MUTATING_TOOLS.includes(name)&&ctx.turnId){const path=(args as{path?:string}).path;if(path)await snapshotBeforeChange(ctx.userId,ctx.projectId!,path,ctx.turnId,name==='deleteProjectFile'?'delete':name==='createProjectFolder'?'create_folder':'write');}
    const shared=!!ctx.projectId;
    switch(name){
      case'verifyProject':{if(shared){const role=await getProjectRole(ctx.userId,ctx.projectId!);if(role==='viewer'){result={ok:false,error:'View-only members can ask questions in Plan mode, but cannot run project verification.'};summary='Blocked project verification for viewer role.';break;}}const verification=await verifyProject(ctx.userId,ctx.projectId!);result=verification;summary=verification.ok?'Verified the project: TypeScript check and Vite build completed successfully.':'Project verification found TypeScript or Vite build errors.';break;}
      case'executeTerminalCommand':{if(shared){const role=await getProjectRole(ctx.userId,ctx.projectId!);if(role==='viewer'){result={ok:false,error:'View-only members cannot run project commands.'};summary='Blocked terminal command for viewer role.';break;}}const a=args as{command:string;args?:string[]};result=await executeTerminalCommand(a.command,a.args??[]);summary=`Ran "${a.command}${a.args?.length?' '+a.args.join(' '):''}"`;break;}
      case'listProjectFiles':{const entries=shared?await listSharedProjectFiles(ctx.userId,ctx.projectId!,false):await listProjectFiles(ctx.userId,ctx.projectId!);result=entries;summary='Listed project files.';break;}
      case'readProjectFile':{const a=args as{path:string};const file=shared?await readSharedProjectFile(ctx.userId,ctx.projectId!,a.path):await readProjectFile(ctx.userId,ctx.projectId!,a.path);const metadata=shared?sharedFileMetadata(file.content,file.path):null;if(metadata){result=metadata;summary=`Read binary file metadata for ${a.path}`;}else{result=file;summary=`Read ${a.path}`;}break;}
      case'writeProjectFile':{const a=args as{path:string;content:string};if(a.content.startsWith(BINARY_PREFIX))throw new Error('K-XpertAI cannot write binary file contents. Upload the file in the workspace and reference its path from code.');if(shared)await writeSharedProjectFile(ctx.userId,ctx.projectId!,a.path,a.content);else{const current=await readProjectFile(ctx.userId,ctx.projectId!,a.path).catch(()=>null);if(typeof current?.content==='string'&&current.content.startsWith(BINARY_PREFIX))throw new Error('K-XpertAI cannot overwrite binary file contents. Upload a replacement file from the workspace.');await writeProjectFile(ctx.userId,ctx.projectId!,a.path,a.content);}result={ok:true,path:a.path};summary=`Wrote ${a.path}`;break;}
      case'createProjectFolder':{const a=args as{path:string};if(shared)await createSharedProjectFolder(ctx.userId,ctx.projectId!,a.path);else await createProjectFolder(ctx.userId,ctx.projectId!,a.path);result={ok:true,path:a.path};summary=`Created folder ${a.path}`;break;}
      case'deleteProjectFile':{const a=args as{path:string};if(shared)await deleteSharedProjectFile(ctx.userId,ctx.projectId!,a.path);else await deleteProjectFile(ctx.userId,ctx.projectId!,a.path);result={ok:true,path:a.path};summary=`Deleted ${a.path}`;break;}
      default:result={ok:false,error:`Unknown tool: ${name}`};summary=`Unknown tool: ${name}`;
    }
    return{result,step:{tool:name,args,status:'ok',summary}};
  }catch(err:any){const result={ok:false,error:err.message};return{result,step:{tool:name,args,status:'error',summary:err.message}};}
}
