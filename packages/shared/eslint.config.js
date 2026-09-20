import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// La capa de la que dependen las tres apps: sin React ni DOM, solo lógica.
export default tseslint.config(
  { ignores: ['src/database.types.ts'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.ts'],
    languageOptions: { ecmaVersion: 2022 },
  },
)
