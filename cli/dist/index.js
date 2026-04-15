var W=Object.defineProperty;var I=(e,t)=>()=>(e&&(t=e(e=0)),t);var j=(e,t)=>{for(var o in t)W(e,o,{get:t[o],enumerable:!0})};var q={};j(q,{streamLLM:()=>k});async function*k(e,t){let{provider:o,model:n,baseUrl:s,apiKey:a}=t;o==="ollama"?yield*ne(e,n,s):yield*re(e,n,s,a)}async function*ne(e,t,o){let n=`${o.replace(/\/$/,"")}/api/chat`,s=await fetch(n,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:t,messages:e,stream:!0}),signal:AbortSignal.timeout(6e5)});if(!s.ok){let a=await s.text().catch(()=>"");throw new Error(`Ollama ${s.status}: ${a.slice(0,200)}`)}if(!s.body)throw new Error("No response body");yield*se(s.body,a=>a.done?null:a.message?.content??null)}async function*re(e,t,o,n){let s=`${o.replace(/\/$/,"")}/chat/completions`,a=await fetch(s,{method:"POST",headers:{"Content-Type":"application/json",...n?{Authorization:`Bearer ${n}`}:{}},body:JSON.stringify({model:t,messages:e,stream:!0}),signal:AbortSignal.timeout(6e5)});if(!a.ok){let i=await a.text().catch(()=>"");throw new Error(`LLM ${a.status}: ${i.slice(0,200)}`)}if(!a.body)throw new Error("No response body");yield*ae(a.body,i=>{if(i==="[DONE]")return null;try{return JSON.parse(i).choices?.[0]?.delta?.content??null}catch{return null}})}async function*se(e,t){let o=e.getReader(),n=new TextDecoder,s="";for(;;){let{done:a,value:i}=await o.read();if(a)break;s+=n.decode(i,{stream:!0});let c=s.split(`
`);s=c.pop()??"";for(let u of c)if(u.trim())try{let l=t(JSON.parse(u));l!=null&&(yield l)}catch{}}}async function*ae(e,t){let o=e.getReader(),n=new TextDecoder,s="";for(;;){let{done:a,value:i}=await o.read();if(a)break;s+=n.decode(i,{stream:!0});let c=s.split(`
`);s=c.pop()??"";for(let u of c){let l=u.replace(/^data:\s*/,"").trim();if(!l)continue;let p=t(l);p!=null&&(yield p)}}}var L=I(()=>{"use strict"});var H={};j(H,{allTools:()=>N,buildSystemPrompt:()=>E,executeTool:()=>M,parseTool:()=>R});import{createContext as ie,runInContext as ce}from"vm";function E(e){let t=N.map(o=>`- **${o.name}**: ${o.description}`).join(`
`);return`You are ${e}, a personal AI agent with live tool access.
Be helpful, direct, and concise. Use markdown formatting where appropriate.

## Use tools for real-time data
- Weather, news, stocks, current events \u2192 call get_weather or web_search
- Calculations \u2192 use run_code
- Facts \u2192 use wikipedia
- Do NOT apologize for lacking real-time access \u2014 use the tools!

## How to call a tool
Emit a fenced code block with language "tool":
\`\`\`tool
{"name":"web_search","arguments":{"query":"latest AI news 2026"}}
\`\`\`

## Available tools
${t}`}function R(e){let t=[];for(let o of e.matchAll(/```tool\s*\r?\n([\s\S]*?)```/g))try{let n=JSON.parse(o[1]);n.name&&t.push(n)}catch{}return t}async function M(e){let t=N.find(o=>o.name===e.name);return t?t.execute(e.arguments??{}):{name:e.name,content:"",error:`Tool "${e.name}" not found`}}var le,ue,me,pe,de,N,_=I(()=>{"use strict";le={name:"web_search",description:"Search the web for current news and information.",async execute({query:e}){let t=String(e??"");try{let o=`https://news.google.com/rss/search?q=${encodeURIComponent(t)}&hl=en-US&gl=US&ceid=US:en`,n=await fetch(o,{signal:AbortSignal.timeout(8e3)});if(!n.ok)throw new Error(`HTTP ${n.status}`);return{name:"web_search",content:[...(await n.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,5).map(c=>{let u=w=>(c[1].match(new RegExp(`<${w}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${w}>`,"i"))?.[1]??"").replace(/<[^>]+>/g,"").trim(),l=u("title"),p=u("description").slice(0,220),h=u("pubDate");return`**${l}**
${p}${h?`
*${h}*`:""}`}).filter(Boolean).join(`

---

`)||"No results."}}catch(o){return{name:"web_search",content:"",error:String(o)}}}},ue={name:"get_weather",description:"Get current weather for any city or location.",async execute({location:e}){let t=String(e??"London");try{let o=await fetch(`https://wttr.in/${encodeURIComponent(t)}?format=j1`,{signal:AbortSignal.timeout(8e3)});if(!o.ok)throw new Error(`HTTP ${o.status}`);let n=await o.json(),s=n.current_condition?.[0],a=n.nearest_area?.[0],i=a?`${a.areaName[0]?.value}, ${a.country[0]?.value}`:t,c=s?.weatherDesc[0]?.value??"";return{name:"get_weather",content:`**${i}**: ${s?.temp_C}\xB0C (feels ${s?.FeelsLikeC}\xB0C), ${c}, wind ${s?.windspeedKmph} km/h, humidity ${s?.humidity}%`}}catch(o){return{name:"get_weather",content:"",error:String(o)}}}},me={name:"get_time",description:"Get the current date and time for a timezone or city.",async execute({location:e}){let t=String(e??"UTC");try{let o=new Date().toLocaleString("en-US",{timeZone:t,hour12:!1,year:"numeric",month:"short",day:"numeric",weekday:"short",hour:"2-digit",minute:"2-digit"});return{name:"get_time",content:`Current time in **${t}**: ${o}`}}catch{return{name:"get_time",content:`UTC: ${new Date().toUTCString()}`}}}},pe={name:"wikipedia",description:"Look up any topic on Wikipedia for factual information.",async execute({query:e}){let t=String(e??"").replace(/ /g,"_");try{let o=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t)}`,{headers:{"User-Agent":"NovaCLI/2.0 (opensource)"},signal:AbortSignal.timeout(8e3)});if(!o.ok)throw new Error(`HTTP ${o.status}`);let n=await o.json();return{name:"wikipedia",content:`**${n.title}**

${n.extract?.slice(0,1500)??""}`}}catch(o){return{name:"wikipedia",content:"",error:String(o)}}}},de={name:"run_code",description:"Execute JavaScript for calculations or data transforms. Use console.log() to print results.",async execute({code:e}){let t=String(e??"").trim();if(/\b(require|import\s*\(|fetch|XMLHttpRequest|child_process|exec|spawn|fs\b|os\b|net\b|eval|Function\s*\(|process\.exit)\b/.test(t))return{name:"run_code",content:"",error:"Blocked: restricted API used."};try{let n=[],s=ie({console:{log:(...a)=>n.push(a.map(String).join(" ")),error:(...a)=>n.push("[err] "+a.map(String).join(" "))},Math,JSON,parseInt,parseFloat,isNaN,isFinite,Array,Object,String,Number,Boolean,Date,Error,Set,Map,RegExp});return ce(t,s,{timeout:5e3}),{name:"run_code",content:n.join(`
`)||"(no output \u2014 use console.log)"}}catch(n){return{name:"run_code",content:"",error:n instanceof Error?n.message:String(n)}}}},N=[le,ue,me,pe,de]});import{Command as ge}from"commander";import Y from"conf";import Q from"os";import X from"path";var m=new Y({projectName:"nova-cli",defaults:{provider:"ollama",model:"llama3",baseUrl:"http://localhost:11434",apiKey:"",agentName:"Nova",theme:"dark",stream:!0}}),$e=X.join(Q.homedir(),".nova");import d from"chalk";import Z from"boxen";import V from"ora";var r={primary:e=>d.hex("#7C3AED")(e),secondary:e=>d.hex("#06B6D4")(e),success:e=>d.hex("#10B981")(e),warning:e=>d.hex("#F59E0B")(e),error:e=>d.hex("#EF4444")(e),muted:e=>d.hex("#9CA3AF")(e),dim:e=>d.dim(e),user:e=>d.hex("#34D399")(e),agent:e=>d.hex("#A78BFA")(e),tool:e=>d.hex("#FCD34D")(e),code:e=>d.hex("#E06C75")(e),bold:d.bold},ee=["  \u2588\u2588\u2588\u2557   \u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557  \u2588\u2588\u2557","  \u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2551\u255A\u2550\u2550\u2588\u2588\u2554\u2550\u2550\u255D\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2588\u2557\u255A\u2588\u2588\u2557\u2588\u2588\u2554\u255D","  \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2554\u255D ","  \u2588\u2588\u2551\u255A\u2588\u2588\u2557\u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551   \u2588\u2588\u2551 \u2588\u2588\u2554\u2588\u2588\u2557 ","  \u2588\u2588\u2551 \u255A\u2588\u2588\u2588\u2588\u2551   \u2588\u2588\u2551   \u255A\u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255D\u2588\u2588\u2554\u255D \u2588\u2588\u2557","  \u255A\u2550\u255D  \u255A\u2550\u2550\u2550\u255D   \u255A\u2550\u255D    \u255A\u2550\u2550\u2550\u2550\u2550\u255D \u255A\u2550\u255D  \u255A\u2550\u255D"],te=["#7C3AED","#8B5CF6","#6D28D9","#4F46E5","#2563EB","#0891B2"];function b(e,t,o="2.0.0"){process.stdout.write("\x1Bc"),process.stdout.write(`
`),ee.forEach((n,s)=>console.log(d.hex(te[s])(n))),console.log(),console.log(r.muted("  Your Personal AI Agent  \xB7  Open Source CLI  \xB7  v"+o)),e&&t&&process.stdout.write(r.dim("  \u2699  ")+r.secondary(e)+r.dim("  \xB7  ")+r.primary(t)+`
`),process.stdout.write(`
`)}function g(e="\u2500",t){let o=Math.min(process.stdout.columns||80,80),n=e.repeat(o);return t?t(n):r.muted(n)}function P(e){return V({text:r.muted(e),spinner:"dots",color:"magenta"})}function A(e){let t=Z(r.error("  "+e+"  "),{padding:{left:1,right:1,top:0,bottom:0},borderStyle:"round",borderColor:"red"});console.error(`
`+t+`
`)}function v(e){console.log(r.secondary("  \u2139  ")+r.muted(e))}function B(e){console.log(r.success("  \u2713  ")+r.muted(e))}function F(){let e=[["/help","Show this help"],["/config","Show current configuration"],["/clear","Clear conversation history"],["/new","Start a fresh conversation"],["/setup","Re-run setup wizard"],["/exit","Exit Nova"]],t=[["Ctrl+C","Quit at any time"],["Ctrl+L","Clear screen"]];console.log(`
`+g()),console.log(r.bold(r.primary(`
  Commands:
`))),e.forEach(([o,n])=>console.log(`  ${r.secondary(o.padEnd(12))}  ${r.muted(n)}`)),console.log(r.bold(r.primary(`
  Shortcuts:
`))),t.forEach(([o,n])=>console.log(`  ${r.secondary(o.padEnd(12))}  ${r.muted(n)}`)),console.log(`
`+g()+`
`)}import{input as f,password as G,select as K,confirm as oe}from"@inquirer/prompts";async function T(e=!1){e||(b(),console.log(r.bold(r.primary(` Welcome to Nova CLI Setup
`))),console.log(r.muted(` This wizard configures your LLM provider.
`)));let t=await K({message:"Select your LLM provider:",choices:[{name:"Ollama  (local, free, private)",value:"ollama"},{name:"LM Studio  (local)",value:"lmstudio"},{name:"OpenAI / Groq / Together AI",value:"openai"},{name:"Custom OpenAI-compatible endpoint",value:"custom"}]}),o="",n="",s="";if(t==="ollama"){n=await f({message:"Ollama URL:",default:"http://localhost:11434"});let i=[];try{let c=await fetch(`${n}/api/tags`,{signal:AbortSignal.timeout(3e3)});c.ok&&(i=(await c.json()).models?.map(l=>l.name)??[])}catch{}i.length>0?o=await K({message:"Select model:",choices:i.map(c=>({name:c,value:c}))}):(i.length===0&&console.log(r.warning(`
  \u26A0  No models found. Run: ollama pull llama3
`)),o=await f({message:"Model name:",default:"llama3"}))}else t==="lmstudio"?(n=await f({message:"LM Studio URL:",default:"http://localhost:1234/v1"}),o=await f({message:"Model name:",default:"default"})):t==="openai"?(n=await f({message:"API Base URL:",default:"https://api.openai.com/v1"}),s=await G({message:"API Key (sk-\u2026):",mask:"*"}),o=await f({message:"Model name:",default:"gpt-4o"})):(n=await f({message:"Endpoint URL:"}),await oe({message:"Does this endpoint require an API key?"})&&(s=await G({message:"API Key:",mask:"*"})),o=await f({message:"Model name:"}));let a=await f({message:"Agent name:",default:m.get("agentName")||"Nova"});m.set("provider",t),m.set("model",o),m.set("baseUrl",n),m.set("apiKey",s),m.set("agentName",a),console.log(),B(`Configuration saved \u2192 ${m.path}`),v(`Run nova to start chatting!
`)}L();import*as J from"readline";_();async function z(){let e=m.store;b(e.provider,e.model),console.log(g()),console.log(r.muted("  Type your message, or /help for commands. Ctrl+C to exit.")),console.log(g()+`
`);let t=[{role:"system",content:E(e.agentName)}],o=J.createInterface({input:process.stdin,output:process.stdout,terminal:!0});process.on("SIGINT",()=>{console.log(r.muted(`

  Goodbye! \u{1F44B}
`)),o.close(),process.exit(0)}),o.on("close",()=>{console.log(r.muted(`
  Session ended.
`)),process.exit(0)});let n=()=>{process.stdout.write(r.user(" You")+r.muted(" \u25B6  "))},s=async a=>{o.pause();let i=a.trim();if(!i){o.resume(),n();return}if(i.startsWith("/")){switch(i.split(" ")[0]?.toLowerCase()){case"/exit":case"/quit":console.log(r.muted(`
  Goodbye! \u{1F44B}
`)),o.close(),process.exit(0);break;case"/help":F();break;case"/clear":case"/new":t.splice(1),v(`Conversation cleared.
`);break;case"/config":{console.log(`
`+g());for(let[u,l]of Object.entries(m.store)){let p=u==="apiKey"?String(l)?"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022":"(not set)":String(l);console.log(`  ${r.secondary(u.padEnd(14))}  ${r.muted(p)}`)}console.log(r.dim(`
  Config: ${m.path}`)),console.log(g()+`
`);break}default:A(`Unknown command: ${i}
Type /help for available commands.`),process.stdout.write(`
`)}o.resume(),n();return}t.push({role:"user",content:i});let c=P(" Thinking\u2026");c.start();try{let u=Date.now(),l="",p=!0;for await(let y of k(t,e))p&&(c.stop(),p=!1,process.stdout.write(`
`+r.agent(` \u{1F916} ${e.agentName}

`))),l+=y,process.stdout.write(r.agent(y));p&&c.stop();let h=R(l),w=[];for(let y of h){process.stdout.write(`
`+r.tool(`  \u26A1 running ${y.name}\u2026`));let $=await M(y);$.error?process.stdout.write(r.error(`  \u2717 ${$.error}
`)):(process.stdout.write(r.success(`  \u2713
`)),w.push(`[${y.name}]
${$.content}`))}if(w.length>0){let y=l.replace(/```tool[\s\S]*?```/g,"").trim();t.push({role:"assistant",content:y||"(calling tools)"}),t.push({role:"user",content:`TOOL RESULTS:

${w.join(`

`)}

Answer the original question using the tool results above. Be concise.`}),process.stdout.write(`
`+r.agent(` \u{1F916} ${e.agentName}

`));let $="";for await(let O of k(t,e))$+=O,process.stdout.write(r.agent(O));t.pop(),t.pop(),t.push({role:"assistant",content:$}),l=$}else t.push({role:"assistant",content:l});let x=Date.now()-u,C=Math.ceil(l.length/3.8),D=C&&x?Math.round(C/(x/1e3)):0,U=g("\u2550");process.stdout.write(`
`),console.log(U),console.log(r.muted(`  \u2191 ~${C} tok \xB7 ${(x/1e3).toFixed(1)}s${D?` \xB7 ${D} tok/s`:""}`)),console.log(U)}catch(u){c.stop();let l=u instanceof Error?u.message:String(u);A(`LLM error: ${l}

Check your config with /config or run: nova setup`)}process.stdout.write(`
`),o.resume(),n()};o.on("line",a=>{s(a)}),n()}var S=new ge;S.name("nova").description("Nova AI Agent - Personal CLI").version("2.0.0","-v, --version","Show version number").helpOption("-h, --help","Show help").action(async()=>{m.get("model")&&m.get("baseUrl")||(console.log(r.warning(`
  No config found - running setup first.
`)),await T(!1)),await z()});S.command("setup").description("Configure LLM provider, model, and agent settings").action(async()=>T());S.command("ask <message...>").description("Ask a single question and print the response (non-interactive)").action(async e=>{let{streamLLM:t}=await Promise.resolve().then(()=>(L(),q)),{buildSystemPrompt:o,parseTool:n,executeTool:s}=await Promise.resolve().then(()=>(_(),H)),a=m.store,i=e.join(" "),c=[{role:"system",content:o(a.agentName)},{role:"user",content:i}];process.stderr.write(r.muted(`
[agent] ${a.agentName}

`));let u="";for await(let p of t(c,a))u+=p,process.stdout.write(p);process.stdout.write(`
`);let l=n(u);for(let p of l){process.stderr.write(r.tool(`* ${p.name}...
`));let h=await s(p);if(h.error){process.stderr.write(r.error(`x ${h.error}
`));continue}process.stderr.write(r.success(`ok ${p.name}
`));let w=[...c,{role:"assistant",content:u},{role:"user",content:`TOOL RESULTS:
[${p.name}]
${h.content}

Answer the original question.`}];for await(let x of t(w,a))process.stdout.write(x);process.stdout.write(`
`)}});S.command("config").description("Show or reset configuration").option("--show","Print current configuration (default)").option("--reset","Reset configuration to defaults").action(e=>{if(e.reset){m.clear(),console.log(r.success(`
  OK Config reset to defaults.
`));return}b(),console.log(`
`+g()),console.log(r.bold(r.primary(`  Configuration
`)));for(let[t,o]of Object.entries(m.store)){let n=t==="apiKey"?String(o)?"********":"(not set)":String(o);console.log(`  ${r.secondary(t.padEnd(14))}  ${r.muted(n)}`)}console.log(r.dim(`
  Config file: ${m.path}`)),console.log(g()+`
`)});S.parse();
