// @ts-check

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig } from 'eslint/config';
import globals from "globals";
import tseslint from 'typescript-eslint';

export default defineConfig(
    {
        ignores: ["dist/**"],
    },
    {
        files: ['**/*.{js,ts}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommendedTypeChecked,
            tseslint.configs.stylisticTypeChecked,
            reactHooks.configs.flat['recommended-latest'],
        ],
        languageOptions: {
            globals: {
                ...globals.browser,
            },
            parserOptions: {
                projectService: true,
            },
        }
    }
);