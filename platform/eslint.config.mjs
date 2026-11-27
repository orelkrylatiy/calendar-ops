import js from '@eslint/js'
import globals from 'globals'
const common={...js.configs.recommended,rules:{...js.configs.recommended.rules,'no-empty':['error',{allowEmptyCatch:true}]}}
export default [
  {ignores:['dist/**','data/**']},
  {...common,files:['server.mjs','test/**/*.mjs'],languageOptions:{globals:globals.node}},
  {...common,files:['src/**/*.js'],languageOptions:{globals:{...globals.browser,Temporal:'readonly'}}},
  {...common,files:['public/sw.js'],languageOptions:{globals:globals.serviceworker}},
]
