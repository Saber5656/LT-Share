import {createServer} from 'node:http';import {resolve} from 'node:path';import {pathToFileURL} from 'node:url';
const worker=(await import(pathToFileURL(resolve('dist/server/index.js')))).default;
const args=process.argv.slice(2),port=Number(args[args.indexOf('--port')+1]||4395);
createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const response=await worker.fetch(new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(body.length?{body}:{})}),{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('Preview error');}}).listen(port,'127.0.0.1',()=>console.log('Worker preview '+port));
