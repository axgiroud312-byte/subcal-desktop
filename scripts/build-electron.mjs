import { build } from 'esbuild';
import { pathToFileURL } from 'node:url';
export async function buildElectron() {
  await Promise.all(['main','preload','collector-worker'].map(name=>build({entryPoints:[name==='preload'?'src/preload/preload.ts':`src/main/${name}.ts`],outfile:`dist-electron/${name}.cjs`,bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron','@github/copilot-sdk'],sourcemap:false,logLevel:'warning'})));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildElectron();
