import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next ships flat configs directly; FlatCompat breaks on ESLint 9
// ("Converting circular structure to JSON"). Same posture as the other Next
// platforms in the stack.
const eslintConfig = [
  { ignores: [".next/**", ".test-build/**", "node_modules/**"] },
  ...nextVitals,
  ...nextTypescript,
];

export default eslintConfig;
