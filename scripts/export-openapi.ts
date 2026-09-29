import { mkdirSync, writeFileSync } from 'node:fs';
import { openApiDocument } from '../server/openapi';
mkdirSync('docs',{recursive:true});
writeFileSync('docs/openapi.json',JSON.stringify(openApiDocument,null,2)+'\n');
console.log('Exported docs/openapi.json');
