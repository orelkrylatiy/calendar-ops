const { defineConfig } = require('cypress')
module.exports = defineConfig({
  video:false,
  screenshotsFolder:'platform/e2e/screenshots',
  e2e:{
    baseUrl:'http://127.0.0.1:4173',
    specPattern:'platform/e2e/**/*.cy.cjs',
    supportFile:false,
    testIsolation:true
  }
})
