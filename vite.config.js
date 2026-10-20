import { defineConfig } from 'vite';
export default defineConfig({
  base:'./', build:{target:'es2020'},
  server:{proxy:{'/api':{
    target:'https://hiprglsqteviimrelrzm.supabase.co',
    changeOrigin:true,
    headers:{origin:'https://ethanlai0312-create.github.io'},
    rewrite:()=>'/functions/v1/exam'
  }}}
});
