// Copia de linea/server/.eslintrc.cjs (commit c44e10eb8f727a3a0a7e52cbf0dcbe304b904570,
// "type": "module", así que un .eslintrc.js se cargaría como ESM y
// explícitamente con `--no-eslintrc -c .eslintrc.cjs` por el mismo motivo.
// linea/server también tiene un .eslintrc.js vestigial que el script de
module.exports = {
  env: {
    browser: true,
    es2021: true
  },
  extends: 'standard',
  overrides: [
    {
      env: {
        node: true
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script'
      }
    }
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    semi: 'off',
    quotes: 'off',
    indent: 'off',
    'comma-dangle': 'off',
    'spaced-comment': 'off',
    'space-before-function-paren': 'off',
    'object-property-newline': 'off',
    'object-curly-spacing': 'off',
    'key-spacing': 'off',
    'no-multi-spaces': 'off',
    'no-trailing-spaces': 'off',
    'space-infix-ops': 'off',
    'operator-linebreak': 'off',
    'padded-blocks': 'off',
    'no-multiple-empty-lines': 'off',
    'eol-last': 'off',
    'quote-props': 'off',
    'multiline-ternary': 'off',
    'comma-spacing': 'off',
    'block-spacing': 'off',
    'brace-style': 'off',
    'array-bracket-spacing': 'off',
    'space-in-parens': 'off',
    'lines-between-class-members': 'off'
  }
}
