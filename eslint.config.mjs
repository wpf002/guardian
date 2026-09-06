import js from "@eslint/js";
import tseslint from "typescript-eslint";

/**
 * One flat config at the root, for every workspace.
 *
 * Each package already had a `lint` script and none of them had ever run: there
 * was no eslint config anywhere, so `pnpm lint` failed the same way in ten
 * workspaces and had been failing since the repository was created. Typecheck,
 * the tests, the theme contrast script and the accusation source scan were all
 * doing real work; this was the one gate that did none.
 *
 * Two tiers, because type-aware rules need a program and only `src` is in one.
 *
 * Everything under `src` gets the type-aware set, which is where the value is:
 * a floating promise is how a write silently does not happen, and the compiler
 * will not tell you about one. Tests and plain JavaScript get the syntax-only
 * set. Test files do have their own tsconfig now, but the project service does
 * not look for `tsconfig.test.json`, and naming every one of them here is a
 * list that goes stale the first time somebody adds a package.
 *
 * The rule set is deliberately narrow. TypeScript already catches most of what
 * a linter is used for here, and turning on a large set at once over a finished
 * codebase produces hundreds of findings that get suppressed rather than read.
 */

/** Rules that need no type information. Applied everywhere. */
const SHARED_RULES = {
  // The compiler reports these, and reporting them twice means reading the
  // same finding twice.
  "no-undef": "off",
  "no-unused-vars": "off",
  // An unused binding prefixed with an underscore is a documented choice: a
  // parameter kept for its position, a destructured field named so the rest
  // can be spread.
  "@typescript-eslint/no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
  ],
  /*
   * Off, with reasons.
   *
   * The codebase talks to a generated Prisma client, to Discord's API and to
   * Json columns, all of which hand back `any` or `unknown` at the edge and are
   * narrowed a line later. These rules fire on the narrowing rather than on the
   * risk, and turning them on would mean a suppression comment on every store.
   * The structural delegate types are the real guard, and they are checked
   * against the generated client at compile time.
   */
  "@typescript-eslint/no-unsafe-assignment": "off",
  "@typescript-eslint/no-unsafe-member-access": "off",
  "@typescript-eslint/no-unsafe-call": "off",
  "@typescript-eslint/no-unsafe-argument": "off",
  "@typescript-eslint/no-unsafe-return": "off",
  "@typescript-eslint/no-explicit-any": "off",
  // Template literals carry ids, counts and enum values constantly.
  "@typescript-eslint/restrict-template-expressions": "off",
  "@typescript-eslint/no-redundant-type-constituents": "off",
  "@typescript-eslint/no-empty-object-type": "off",
  /*
   * Off because the memory twins are the reason it fires. MemoryAuditStore,
   * MemoryDeliveryStore and MemoryKernelStore implement interfaces whose
   * methods return promises, so their methods have to be async and have nothing
   * to await. The rule is right about the general case and wrong about every
   * instance of it in this repository.
   */
  "@typescript-eslint/require-await": "off",
  // Grouped case labels with a comment between them are not a fallthrough.
  // The switch in apps/scorer/src/pair.ts groups the critical signals and
  // explains one of them in a comment, which this reads as a statement.
  "no-fallthrough": ["error", { allowEmptyCase: true }],
  /*
   * Off, and this one bit. apps/review's tsconfig does not set
   * noUncheckedIndexedAccess and scripts/integration's does, and the
   * integration suite compiles apps/review's data layer to drive the real
   * decision path. So the same `cases[0]!` is unnecessary under one config and
   * required under the other, and the rule's autofix removed assertions that
   * the second compiler then demanded back. "Unnecessary" is not a property of
   * the file here.
   */
  "@typescript-eslint/no-unnecessary-type-assertion": "off",
};

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.venv/**",
      "**/__pycache__/**",
      "**/generated/**",
      "docs/**",
      "packages/schema/prisma/migrations/**",
    ],
  },

  js.configs.recommended,

  // Syntax only, everywhere. The typed block below adds to this for src.
  {
    files: ["**/*.ts", "**/*.tsx", "**/*.mts"],
    extends: [...tseslint.configs.recommended],
    rules: SHARED_RULES,
  },

  // Type-aware, for the code that ships.
  {
    files: ["**/src/**/*.ts", "**/src/**/*.tsx"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...SHARED_RULES,
      // A promise nobody waits for is how a write silently does not happen.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
    },
  },

  {
    // Test files reach into internals on purpose, and a non-null assertion in a
    // fixture is clearer than a guard clause that can never fire.
    files: ["**/test/**", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/unbound-method": "off",
      // One test builds a function from a string to check a runtime guard.
      "@typescript-eslint/no-implied-eval": "off",
    },
  },

  {
    // Plain JavaScript: this config, the theme generator, the docs renderer,
    // the parity check. No tsconfig covers them, so nothing type-aware runs.
    files: ["**/*.mjs", "**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      parserOptions: { projectService: false, project: false },
      globals: { console: "readonly", process: "readonly", Buffer: "readonly" },
    },
    rules: { ...tseslint.configs.disableTypeChecked.rules, "no-console": "off" },
  },
);
