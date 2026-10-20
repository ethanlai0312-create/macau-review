import {readFileSync,writeFileSync} from 'node:fs';
import * as OpenCC from 'opencc-js/cn2t';
import {parse} from 'acorn';
const convert=OpenCC.Converter({from:'cn',to:'tw'});
const values=new Set(['城市发展','经济发展','交通发展','资源与环境','基础','理解','综合']);
for(const file of ['src/main.js','src/diagrams.js']){
  const source=readFileSync(file,'utf8');
  const visit=node=>{
    if(!node||typeof node!=='object')return;
    if(node.type==='Literal'&&typeof node.value==='string'&&/[\u3400-\u9fff]/.test(node.value))values.add(node.value);
    for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(visit);else if(value&&typeof value==='object')visit(value);
  };
  visit(parse(source,{ecmaVersion:'latest',sourceType:'module'}));
}
const translations=Object.fromEntries([...values].map(value=>[value,convert(value)]));
writeFileSync('src/translations.json',JSON.stringify(translations,null,2)+'\n');
console.log(`Generated ${values.size} UI translations; no runtime dictionary download required.`);
