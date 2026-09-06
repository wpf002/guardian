import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * The reviewer console keeps its own config, because eslint-config-next carries
 * rules about this app that the root config has no reason to know: the image
 * component, the link component, the app router's own constraints. A flat
 * config in a workspace shadows the root one, so this is the whole config for
 * apps/review rather than an addition to it.
 *
 * The one rule repeated from the root is the underscore convention. A parameter
 * kept for its position and named with a leading underscore is a documented
 * choice, and useActionState hands every action a previous state and a form
 * whether or not the action reads them.
 */
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
